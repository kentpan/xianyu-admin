/** PUT /api/keywords/:cookieId/:index — update keyword by id (param named [index] but treated as keyword id). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const index = getRouterParam(event, 'index') || ''
    const body = await readBody(event)
    const db = await getDb()

    const r = await db.run(
      `UPDATE keywords SET keyword = ?, reply = ?, item_id = ?, type = ?, image_url = ? WHERE id = ? AND cookie_id = ?`,
      [body.keyword, body.reply, body.item_id || '', body.type || 'text', body.image_url || null, Number(index), cookieId],
    )
    if (r.changes === 0) throw new ApiError(404, '关键词不存在')

    return ok({ id: Number(index) }, '关键词已更新')
  }),
)
