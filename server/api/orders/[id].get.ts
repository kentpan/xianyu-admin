/** GET /api/orders/:id — get one order detail. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()

    const order = await db.get(
      `SELECT o.*, ii.item_title, ii.item_price, c.remark AS cookie_remark
       FROM orders o
       LEFT JOIN item_info ii ON ii.cookie_id = o.cookie_id AND ii.item_id = o.item_id
       LEFT JOIN cookies c ON c.id = o.cookie_id
       WHERE o.order_id = ?`,
      [id],
    )
    if (!order) throw new ApiError(404, '订单不存在')

    return ok(order)
  }),
)
