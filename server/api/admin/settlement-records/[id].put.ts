/**
 * PUT /api/admin/settlement-records/:id — 管理员审核提现记录
 *
 * Body: { status, reject_reason? }
 *   status: 'approved' | 'rejected' | 'paid'
 *
 * - rejected: 若原状态为 pending_review 或 approved, 则退款 (addBalance)
 * - approved: 仅当原状态为 pending_review 时允许
 * - paid: 标记为已线下付款 (仅当原状态为 approved 时允许)
 */

export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的记录 ID')
    const db = await getDb()
    const body = await readBody(event) || {}

    const status = (body.status || '').toString()
    if (!['approved', 'rejected', 'paid'].includes(status)) {
      throw new ApiError(400, 'status 仅支持 approved / rejected / paid')
    }

    const record = await db.get<{
      id: number; user_id: number; amount: string; status: string
    }>(
      'SELECT id, user_id, amount, status FROM settlement_records WHERE id = ?',
      [id],
    )
    if (!record) throw new ApiError(404, '提现记录不存在')

    const rejectReason = body.reject_reason ? String(body.reject_reason).slice(0, 500) : null

    await db.transaction(async () => {
      if (status === 'approved') {
        if (record.status !== 'pending_review') {
          throw new ApiError(400, `仅 pending_review 状态可审核通过, 当前状态: ${record.status}`)
        }
        await db.run(
          `UPDATE settlement_records SET status = 'approved',
            remark = COALESCE(remark, '') || ' | 管理员后台审核通过',
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [id],
        )
      } else if (status === 'rejected') {
        if (!['pending_review', 'approved'].includes(record.status)) {
          throw new ApiError(400, `当前状态不可拒绝: ${record.status}`)
        }
        await db.run(
          `UPDATE settlement_records SET status = 'rejected',
            reject_reason = ?,
            remark = COALESCE(remark, '') || ' | 管理员后台拒绝并退款',
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [rejectReason || '管理员拒绝', id],
        )
        // 退款
        await addBalance(
          db, record.user_id, record.amount,
          `提现被拒绝-退款（结算记录ID: ${record.id}${rejectReason ? `, 原因: ${rejectReason}` : ''}）`,
          { flowType: 'income', orderId: null, dockRecordId: null },
        )
      } else if (status === 'paid') {
        if (record.status !== 'approved') {
          throw new ApiError(400, `仅 approved 状态可标记为已付款, 当前状态: ${record.status}`)
        }
        await db.run(
          `UPDATE settlement_records SET status = 'paid',
            remark = COALESCE(remark, '') || ' | 已线下付款',
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [id],
        )
      }
    })

    return ok({ id, status }, '已更新')
  }),
)
