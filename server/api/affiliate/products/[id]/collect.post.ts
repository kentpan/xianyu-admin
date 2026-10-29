/** POST /api/affiliate/products/:id/collect — 收藏/取消收藏选品商品。 Body: { collected: 0|1 } */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的 id')
    const body = await readBody(event)
    const collected = body?.collected ? 1 : 0

    const row = await db.get<any>('SELECT id, user_id FROM affiliate_products WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '商品不存在')
    if (!payload.isAdmin && row.user_id !== payload.userId) throw new ApiError(403, '无权操作')

    await db.run('UPDATE affiliate_products SET collected = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [collected, id])
    return ok({ id, collected }, collected ? '已收藏' : '已取消收藏')
  }),
)
