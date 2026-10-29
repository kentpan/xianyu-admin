/**
 * GET /api/distribution/agent-orders/upstream — 代理我的订单 (别人用我的卡券/对接发的货)
 *
 * 即我作为货主 (owner_user_id=current) 或一级分销 (upstream_user_id=current) 收到的订单
 * Query: page, page_size, status, search
 * 普通用户: 仅涉及自己的; 管理员: 全部
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size || Number(q.pageSize || 20))))
    const status = (q.status || '').toString().trim()
    const search = (q.search || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (!payload.isAdmin) {
      where.push('(a.owner_user_id = ? OR a.upstream_user_id = ?)')
      params.push(payload.userId, payload.userId)
    }
    if (status) {
      where.push('a.status = ?')
      params.push(status)
    }
    if (search) {
      where.push('(a.order_no LIKE ? OR a.buyer_id LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM agent_orders a ${whereSql}`,
      params,
    )
    const total = totalRow?.c || 0

    const offset = (page - 1) * pageSize
    const items = await db.all(
      `SELECT a.id, a.order_no, a.item_id, a.card_id, a.dock_record_id, a.dock_level,
              a.sale_price, a.dock_price, a.card_price, a.level2_cost, a.profit,
              a.fee_amount, a.fee_payer,
              a.user_id AS dealer_user_id,
              a.upstream_user_id, a.upstream_dock_record_id, a.owner_user_id,
              a.buyer_id, a.status, a.settle_remark,
              a.created_at, a.updated_at,
              c.name AS card_name,
              u.username AS dealer_username,
              uu.username AS upstream_username,
              ou.username AS owner_username
       FROM agent_orders a
       LEFT JOIN cards c ON c.id = a.card_id
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN users uu ON uu.id = a.upstream_user_id
       LEFT JOIN users ou ON ou.id = a.owner_user_id
       ${whereSql}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    return ok({ items, total, page, page_size: pageSize })
  }),
)
