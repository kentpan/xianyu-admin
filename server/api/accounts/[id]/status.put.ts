/** PUT /api/accounts/:id/status — toggle or set cookie enabled status. */
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

    let enabled: number
    if (body.enabled !== undefined) {
      enabled = body.enabled ? 1 : 0
    } else {
      const cur = await db.get<{ enabled: number }>(
        'SELECT enabled FROM cookie_status WHERE cookie_id = ?',
        [id],
      )
      enabled = cur?.enabled ? 0 : 1
    }

    await db.run(
      `INSERT INTO cookie_status (cookie_id, enabled, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(cookie_id) DO UPDATE SET enabled = ?, updated_at = CURRENT_TIMESTAMP`,
      [id, enabled, enabled],
    )

    return ok({ id, enabled }, enabled ? '账号已启用' : '账号已停用')
  }),
)
