/** DELETE /api/keywords/:cookieId/:index — delete keyword by id (param named [index] but treated as keyword id). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const index = getRouterParam(event, 'index') || ''
    const db = await getDb()

    const r = await db.run(
      'DELETE FROM keywords WHERE id = ? AND cookie_id = ?',
      [Number(index), cookieId],
    )
    if (r.changes === 0) throw new ApiError(404, '关键词不存在')

    return ok({ id: Number(index) }, '关键词已删除')
  }),
)
