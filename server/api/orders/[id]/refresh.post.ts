/** POST /api/orders/:id/refresh — stub: bump updated_at to mark as refreshed. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()

    const existing = await db.get('SELECT order_id FROM orders WHERE order_id = ?', [id])
    if (!existing) throw new ApiError(404, '订单不存在')

    await db.run(
      'UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE order_id = ?',
      [id],
    )
    return ok({ order_id: id, refreshed_at: new Date().toISOString() }, '订单已同步')
  }),
)
