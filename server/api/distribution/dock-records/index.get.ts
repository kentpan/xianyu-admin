/**
 * GET /api/distribution/dock-records — 我的对接记录
 *
 * Query: page, page_size, search, status, level, allow_sub_dock
 * 普通用户: 仅自己; 管理员: 全部
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size || Number(q.pageSize || 20))))
    const search = (q.search || '').toString().trim()
    const status = (q.status || '').toString().trim()
    const level = (q.level || '').toString().trim()
    const allowSub = (q.allow_sub_dock || '').toString().trim()

    const where: string[] = []
    const params: any[] = []

    if (!payload.isAdmin) {
      where.push('d.user_id = ?')
      params.push(payload.userId)
    }
    if (search) {
      where.push('(d.dock_name LIKE ? OR c.name LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    if (status === '1' || status === '0') {
      where.push('d.status = ?')
      params.push(Number(status))
    }
    if (level === '1' || level === '2') {
      where.push('d.level = ?')
      params.push(Number(level))
    }
    if (allowSub === '1' || allowSub === '0') {
      where.push('d.allow_sub_dock = ?')
      params.push(Number(allowSub))
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM dock_records d LEFT JOIN cards c ON c.id = d.card_id ${whereSql}`,
      params,
    )
    const total = totalRow?.c || 0

    const offset = (page - 1) * pageSize
    const items = await db.all(
      `SELECT d.*, c.name AS card_name, c.type AS card_type, c.price AS card_price,
              c.fee_payer, c.is_dockable, c.enabled AS card_enabled,
              c.user_id AS card_owner_user_id, cu.username AS card_owner_username
       FROM dock_records d
       LEFT JOIN cards c ON c.id = d.card_id
       LEFT JOIN users cu ON cu.id = c.user_id
       ${whereSql}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    return ok({ items, total, page, page_size: pageSize })
  }),
)
