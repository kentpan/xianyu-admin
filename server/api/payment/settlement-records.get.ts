/**
 * GET /api/payment/settlement-records — 我的提现记录
 *
 * Query: page, page_size, status
 * 普通用户: 仅自己; 管理员: 全部
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size || Number(q.pageSize || 20))))
    const status = (q.status || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (!payload.isAdmin) {
      where.push('s.user_id = ?')
      params.push(payload.userId)
    }
    if (status) {
      where.push('s.status = ?')
      params.push(status)
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM settlement_records s ${whereSql}`,
      params,
    )
    const total = totalRow?.c || 0

    const offset = (page - 1) * pageSize
    const items = await db.all(
      `SELECT s.id, s.user_id, s.payment_type, s.payment_qrcode, s.alipay_id,
              s.amount, s.status, s.remark, s.reject_reason,
              s.created_at, s.updated_at,
              u.username
       FROM settlement_records s
       LEFT JOIN users u ON u.id = s.user_id
       ${whereSql}
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    return ok({ items, total, page, page_size: pageSize })
  }),
)
