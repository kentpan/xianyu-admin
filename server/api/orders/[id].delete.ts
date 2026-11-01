/** DELETE /api/orders/:id — delete order (登记屏蔽表, 同步永不拉回). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()

    const row = await db.get<{ cookie_id: string }>('SELECT cookie_id FROM orders WHERE order_id = ?', [id])
    const r = await db.run('DELETE FROM orders WHERE order_id = ?', [id])
    if (r.changes === 0) throw new ApiError(404, '订单不存在')

    // 登记删除屏蔽: 否则下一轮订单同步 (列表拉取/卡片兜底) 会原样拉回, 表现为「删不掉」
    await rememberDeletedOrder(db, id, String(row?.cookie_id || ''))

    return ok({ order_id: id }, '订单已删除 (同步不再拉回)')
  }),
)
