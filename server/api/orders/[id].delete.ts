/** DELETE /api/orders/:id — delete order. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()

    const r = await db.run('DELETE FROM orders WHERE order_id = ?', [id])
    if (r.changes === 0) throw new ApiError(404, '订单不存在')

    return ok({ order_id: id }, '订单已删除')
  }),
)
