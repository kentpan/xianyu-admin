/**
 * GET /api/distribution/sub-supply — 二级分销货源广场
 *
 * 列出其他用户开启二级分销的一级对接记录 (allow_sub_dock=1 AND status=1)
 * 用于当前用户从中选择创建二级对接
 *
 * Query: page, page_size, search
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size || Number(q.pageSize || 20))))
    const search = (q.search || '').toString().trim()

    const where: string[] = [
      'd.allow_sub_dock = 1',
      'd.status = 1',
      'd.level = 1',
      'd.user_id != ?',
    ]
    const params: any[] = [payload.userId]

    if (search) {
      where.push('(d.dock_name LIKE ? OR c.name LIKE ? OR u.username LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    const whereSql = where.join(' AND ')

    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c
       FROM dock_records d
       LEFT JOIN cards c ON c.id = d.card_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE ${whereSql}`,
      params,
    )
    const total = totalRow?.c || 0

    const offset = (page - 1) * pageSize
    const items = await db.all(
      `SELECT d.id, d.dock_name, d.sub_dock_price, d.sub_dock_visibility,
              d.delivery_count, d.created_at,
              c.id AS card_id, c.name AS card_name, c.type AS card_type,
              c.price AS card_price, c.fee_payer,
              d.user_id AS level1_user_id, u.username AS level1_username
       FROM dock_records d
       LEFT JOIN cards c ON c.id = d.card_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE ${whereSql}
       ORDER BY d.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    return ok({ items, total, page, page_size: pageSize })
  }),
)
