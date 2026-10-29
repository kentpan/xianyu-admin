/** PUT /api/accounts/:id/auto-confirm — set auto_confirm flag. */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()
    const body = await readBody(event) || {}

    const existing = await db.get('SELECT id, user_id FROM cookies WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && existing.user_id !== payload.userId) {
      throw new ApiError(403, '无权操作此账号')
    }

    const auto_confirm = body.auto_confirm ? 1 : 0
    await db.run('UPDATE cookies SET auto_confirm = ? WHERE id = ?', [auto_confirm, id])

    return ok({ id, auto_confirm }, '已更新自动确认设置')
  }),
)
