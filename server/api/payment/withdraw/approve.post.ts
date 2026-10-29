/**
 * POST /api/payment/withdraw/approve — 通过提现审核 (无登录, token-gated)
 *
 * 表单 body: { id, token }
 * 校验 token → 设置 settlement_record.status='approved'
 * 返回纯文本 'success' / 'failure'
 */

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')

  const body = await readBody(event).catch(() => ({})) || {}
  const id = Number(body.id || 0)
  const token = (body.token || '').toString().replace(/[^a-f0-9]/gi, '')

  if (!id || !token || !verifyReviewToken(id, 'approve', token)) {
    setResponseStatus(event, 200)
    return 'failure: invalid token'
  }

  try {
    const db = await getDb()
    const record = await db.get<{ id: number; status: string }>(
      'SELECT id, status FROM settlement_records WHERE id = ?',
      [id],
    )
    if (!record) return 'failure: record not found'
    if (record.status !== 'pending_review') {
      return `failure: status is ${record.status}`
    }

    await db.run(
      `UPDATE settlement_records
       SET status = 'approved',
           remark = COALESCE(remark, '') || ' | 管理员已通过审核',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id],
    )

    return 'success'
  } catch (e: any) {
    return `failure: ${e?.message || 'internal error'}`
  }
})
