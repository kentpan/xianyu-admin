/**
 * POST /api/payment/withdraw — 发起提现申请
 *
 * Body: { amount }
 * 流程:
 *   1. 校验金额 (>0, >= withdraw.min_amount, <= withdraw.max_amount, <= balance)
 *   2. 校验用户已上传 payment_qrcode (从 user_settings 读取)
 *   3. 事务内:
 *      - 扣减余额 (fund_flows.type='expense')
 *      - 创建 settlement_record (status='pending_review')
 *   4. (异步发送邮件通知 — 若配置了 withdraw.notify_email)
 *
 * 返回: { id, amount, status, balance }
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const amountStr = (body.amount || '').toString().trim()
    let amount: ReturnType<typeof toDecimal>
    try {
      amount = new Decimal(amountStr)
    } catch {
      throw new ApiError(400, '金额格式错误')
    }
    if (amount.lte(0)) throw new ApiError(400, '提现金额必须大于 0')

    // 读取配置
    const minRow = await db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key_name = 'withdraw.min_amount'",
    )
    const maxRow = await db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key_name = 'withdraw.max_amount'",
    )
    const minAmount = toDecimal(minRow?.value || '1')
    const maxAmount = toDecimal(maxRow?.value || '10000')

    if (amount.lt(minAmount)) {
      throw new ApiError(400, `最低提现金额为 ${fmtMoney(minAmount)} 元`)
    }
    if (amount.gt(maxAmount)) {
      throw new ApiError(400, `单笔最高提现金额为 ${fmtMoney(maxAmount)} 元`)
    }

    // 校验余额
    const balance = toDecimal(await getBalance(db, payload.userId))
    if (amount.gt(balance)) {
      throw new ApiError(400, '余额不足')
    }

    // 校验收款码
    const paymentQrcode = await getUserSetting(db, payload.userId, 'payment_qrcode')
    if (!paymentQrcode) throw new ApiError(400, '请先在个人中心上传收款码')
    const paymentType = (await getUserSetting(db, payload.userId, 'payment_type')) || 'alipay'
    const alipayId = await getUserSetting(db, payload.userId, 'alipay_id')

    // 事务: 扣余额 + 创建结算记录
    const result = await db.transaction(async () => {
      const { balanceAfter } = await deductBalance(
        db, payload.userId, amount,
        `余额提现申请`,
        { flowType: 'expense', orderId: null, dockRecordId: null },
      )

      const ins = await db.run(
        `INSERT INTO settlement_records (
          user_id, payment_type, payment_qrcode, alipay_id, amount,
          status, remark, reject_reason,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending_review', '用户发起提现申请', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          payload.userId,
          paymentType,
          paymentQrcode,
          alipayId || null,
          fmtMoney(amount),
        ],
      )

      // 在流水中关联结算记录 id (更新最近一条流水的 description)
      await db.run(
        `UPDATE fund_flows SET description = ? WHERE user_id = ? AND id = (
          SELECT MAX(id) FROM fund_flows WHERE user_id = ?
        )`,
        [`余额提现申请，结算记录ID: ${ins.lastInsertId}`, payload.userId, payload.userId],
      )

      return { recordId: Number(ins.lastInsertId), balanceAfter }
    })

    // 异步邮件通知 (不阻塞响应)
    sendWithdrawNotify(payload.userId, fmtMoney(amount), result.recordId).catch(() => {})

    return ok({
      id: result.recordId,
      amount: fmtMoney(amount),
      status: 'pending_review',
      balance: result.balanceAfter,
    }, '提现申请已提交, 等待审核')
  }),
)

/** 异步发送提现邮件通知 (若配置了 notify_email) — 统一走 sendMail (SMTP/Resend 自动分流) */
async function sendWithdrawNotify(userId: number, amount: string, recordId: number): Promise<void> {
  try {
    const db = await getDb()
    const emailRow = await db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key_name = 'withdraw.notify_email'",
    )
    if (!emailRow?.value) return // 未配置邮箱, 跳过 (改由管理员后台审核)

    const reviewUrl = `${getReviewBaseUrl()}/api/payment/withdraw/review?id=${recordId}&action=approve&token=${genReviewToken(recordId, 'approve')}`
    const rejectUrl = `${getReviewBaseUrl()}/api/payment/withdraw/review?id=${recordId}&action=reject&token=${genReviewToken(recordId, 'reject')}`

    const result = await sendMail({
      to: emailRow.value,
      subject: `[提现申请] 用户 #${userId} 申请提现 ${amount} 元`,
      html: `
        <h3>新的提现申请</h3>
        <p>用户 ID: ${userId}</p>
        <p>提现金额: ${amount} 元</p>
        <p>结算记录 ID: ${recordId}</p>
        <p>请点击以下链接进行审核:</p>
        <p><a href="${reviewUrl}">通过审核</a> | <a href="${rejectUrl}">拒绝审核</a></p>
      `,
    })

    if (!result.sent) {
      console.log(`[withdraw-notify] 邮件未发送 (${result.error}), 降级为日志. recordId=${recordId} amount=${amount}`)
      console.log(`[withdraw-notify] approve=${reviewUrl}`)
      console.log(`[withdraw-notify] reject=${rejectUrl}`)
    }
  } catch (e) {
    console.log('[withdraw-notify] error:', (e as Error).message)
  }
}

function getReviewBaseUrl(): string {
  // 简单回退: 使用相对路径, 由调用方/前端拼接 host
  return ''
}

// genReviewToken is auto-imported from server/utils/distribution/review-token
