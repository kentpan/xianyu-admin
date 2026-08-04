/** POST /api/orders/manual-ship — manually mark an order as shipped.
 *  Body: { order_id, mode: 'status_only' | 'full' } */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}
    const order_id = (body.order_id || '').toString().trim()
    const mode = (body.mode || 'status_only').toString() === 'full' ? 'full' : 'status_only'

    if (!order_id) throw new ApiError(400, '订单号不能为空')

    const existing = await db.get('SELECT order_id FROM orders WHERE order_id = ?', [order_id])
    if (!existing) throw new ApiError(404, '订单不存在')

    await db.run(
      `UPDATE orders SET order_status = 'shipped', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
      [order_id],
    )

    return ok({ order_id, mode, shipped: true }, '已标记为已发货')
  }),
)
