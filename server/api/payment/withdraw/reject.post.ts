/**
 * POST /api/payment/withdraw/reject — 拒绝提现审核 (无登录, token-gated)
 *
 * 表单 body: { id, token, reject_reason }
 * 校验 token → 设置 status='rejected' + reject_reason → 退款 (addBalance, flow_type='income')
 * 返回纯文本 'success' / 'failure'
 */

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')

  const body = await readBody(event).catch(() => ({})) || {}
  const id = Number(body.id || 0)
  const token = (body.token || '').toString().replace(/[^a-f0-9]/gi, '')
  const rejectReason = (body.reject_reason || '').toString().trim().slice(0, 500)

  if (!id || !token || !verifyReviewToken(id, 'reject', token)) {
    setResponseStatus(event, 200)
    return 'failure: invalid token'
  }
  if (!rejectReason) {
    return 'failure: reject_reason required'
  }

  try {
    const db = await getDb()

    const result = await db.transaction(async () => {
      const record = await db.get<{ id: number; user_id: number; amount: string; status: string }>(
        'SELECT id, user_id, amount, status FROM settlement_records WHERE id = ?',
        [id],
      )
      if (!record) throw new Error('record not found')
      if (record.status !== 'pending_review') {
        throw new Error(`status is ${record.status}`)
      }

      // 更新结算记录
      await db.run(
        `UPDATE settlement_records
         SET status = 'rejected',
             reject_reason = ?,
             remark = COALESCE(remark, '') || ' | 已拒绝并退款',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [rejectReason, id],
      )

      // 退款 (flow_type='income', 描述包含"提现被拒绝-退款")
      await addBalance(
        db, record.user_id, record.amount,
        `提现被拒绝-退款（结算记录ID: ${record.id}, 原因: ${rejectReason}）`,
        { flowType: 'income', orderId: null, dockRecordId: null },
      )

      return true
    })

    return result ? 'success' : 'failure'
  } catch (e: any) {
    return `failure: ${e?.message || 'internal error'}`
  }
})
