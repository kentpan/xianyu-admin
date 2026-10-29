/**
 * GET /api/distribution/agent-orders/:id — 代理订单详情
 *
 * 访问权限: 当前用户为该订单的 user_id / upstream_user_id / owner_user_id, 或管理员
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的订单 ID')
    const db = await getDb()

    const row = await db.get<any>(
      `SELECT a.*,
              c.name AS card_name, c.type AS card_type,
              u.username AS dealer_username,
              uu.username AS upstream_username,
              ou.username AS owner_username
       FROM agent_orders a
       LEFT JOIN cards c ON c.id = a.card_id
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN users uu ON uu.id = a.upstream_user_id
       LEFT JOIN users ou ON ou.id = a.owner_user_id
       WHERE a.id = ?`,
      [id],
    )
    if (!row) throw new ApiError(404, '订单不存在')

    const allowed =
      payload.isAdmin ||
      row.user_id === payload.userId ||
      row.upstream_user_id === payload.userId ||
      row.owner_user_id === payload.userId
    if (!allowed) throw new ApiError(403, '无权查看该订单')

    return ok(row)
  }),
)
