/**
 * GET /api/distribution/supply — 货源广场
 *
 * 列出当前用户可对接的卡券 (其他用户拥有且 is_dockable=1)
 * - 公开卡券 (dock_visibility='public') 任意可见
 * - dealer_only 卡券仅当当前用户与该货主存在 dock_code_binding 时可见
 * - 排除自己拥有的卡券
 *
 * Query: page, page_size, search, type
 */

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size || Number(q.pageSize || 20))))
    const search = (q.search || '').toString().trim()
    const type = (q.type || '').toString().trim()

    const where: string[] = [
      'c.is_dockable = 1',
      'c.enabled = 1',
      'c.user_id != ?',
      "(c.dock_visibility = 'public' OR c.dock_visibility IS NULL OR b.id IS NOT NULL)",
    ]
    // 第一个 ? 是 JOIN 的 b.user_id, 第二个 ? 是 WHERE 的 c.user_id != ?
    // 所以传入 [userId, userId, ...filters]
    const params: any[] = [payload.userId, payload.userId]

    if (search) {
      where.push('(c.name LIKE ? OR u.username LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    if (type) {
      where.push('c.type = ?')
      params.push(type)
    }

    const whereSql = where.join(' AND ')

    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c
       FROM cards c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN dock_code_bindings b ON b.user_id = ? AND b.target_user_id = c.user_id
       WHERE ${whereSql}`,
      params,
    )
    const total = totalRow?.c || 0

    const offset = (page - 1) * pageSize
    const items = await db.all(
      `SELECT c.id, c.name, c.type, c.description, c.price, c.min_price,
              c.dock_visibility, c.fee_payer, c.is_multi_spec, c.spec_name, c.spec_value,
              c.user_id AS owner_user_id, u.username AS owner_username,
              c.created_at, c.updated_at
       FROM cards c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN dock_code_bindings b ON b.user_id = ? AND b.target_user_id = c.user_id
       WHERE ${whereSql}
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    // 顺带返回当前用户的对接码 (前端可显示给上货主)
    const myDockCode = await getOrCreateDockCode(db, payload.userId)

    return ok({ items, total, page, page_size: pageSize, my_dock_code: myDockCode })
  }),
)
