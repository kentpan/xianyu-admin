/** GET /api/cards/:id — fetch a single card. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的卡券 ID')

    const db = await getDb()
    const card = await db.get('SELECT * FROM cards WHERE id = ?', [id])
    if (!card) throw new ApiError(404, '卡券不存在')
    return ok(card)
  }),
)
