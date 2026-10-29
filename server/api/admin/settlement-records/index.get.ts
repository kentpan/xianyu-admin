/**
 * GET /api/admin/settlement-records — 管理员查看所有提现记录
 *
 * Query: page, page_size, status, search
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size || Number(q.pageSize || 20))))
    const status = (q.status || '').toString().trim()
    const search = (q.search || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (status) {
      where.push('s.status = ?')
      params.push(status)
    }
    if (search) {
      where.push('(u.username LIKE ? OR CAST(s.user_id AS TEXT) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c
       FROM settlement_records s
       LEFT JOIN users u ON u.id = s.user_id
       ${whereSql}`,
      params,
    )
    const total = totalRow?.c || 0

    const offset = (page - 1) * pageSize
    const items = await db.all(
      `SELECT s.id, s.user_id, s.payment_type, s.payment_qrcode, s.alipay_id,
              s.amount, s.status, s.remark, s.reject_reason,
              s.created_at, s.updated_at,
              u.username, u.email
       FROM settlement_records s
       LEFT JOIN users u ON u.id = s.user_id
       ${whereSql}
       ORDER BY
         CASE s.status
           WHEN 'pending_review' THEN 0
           WHEN 'approved' THEN 1
           WHEN 'rejected' THEN 2
           WHEN 'paid' THEN 3
           ELSE 4
         END,
         s.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    return ok({ items, total, page, page_size: pageSize })
  }),
)
