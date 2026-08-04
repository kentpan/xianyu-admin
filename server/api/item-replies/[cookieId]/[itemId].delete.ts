/** DELETE /api/item-replies/:cookieId/:itemId — delete item reply. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const itemId = getRouterParam(event, 'itemId') || ''
    const db = await getDb()

    const r = await db.run(
      'DELETE FROM item_replay WHERE cookie_id = ? AND item_id = ?',
      [cookieId, itemId],
    )
    if (r.changes === 0) throw new ApiError(404, '回复不存在')

    return ok({ cookieId, itemId }, '回复已删除')
  }),
)
