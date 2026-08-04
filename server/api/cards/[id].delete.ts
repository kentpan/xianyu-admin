/** DELETE /api/cards/:id — delete a card. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的卡券 ID')
    const db = await getDb()
    const r = await db.run('DELETE FROM cards WHERE id = ?', [id])
    if (!r.changes) throw new ApiError(404, '卡券不存在')
    return ok({ id }, '卡券已删除')
  }),
)
