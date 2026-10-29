/**
 * GET /api/distribution/fund-flows — 资金流水
 *
 * Query: page, page_size, type, search
 * 普通用户: 仅自己; 管理员: 全部
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size || Number(q.pageSize || 20))))
    const type = (q.type || '').toString().trim()
    const search = (q.search || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (!payload.isAdmin) {
      where.push('f.user_id = ?')
      params.push(payload.userId)
    }
    if (type && ['income', 'expense', 'fee'].includes(type)) {
      where.push('f.type = ?')
      params.push(type)
    }
    if (search) {
      where.push('f.description LIKE ?')
      params.push(`%${search}%`)
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM fund_flows f ${whereSql}`,
      params,
    )
    const total = totalRow?.c || 0

    const offset = (page - 1) * pageSize
    const items = await db.all(
      `SELECT f.*, u.username
       FROM fund_flows f
       LEFT JOIN users u ON u.id = f.user_id
       ${whereSql}
       ORDER BY f.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    return ok({ items, total, page, page_size: pageSize })
  }),
)
