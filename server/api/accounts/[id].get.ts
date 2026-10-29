/** GET /api/accounts/:id — cookie detail + ai_reply_settings + default_replies. */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()

    const cookie = await db.get('SELECT * FROM cookies WHERE id = ?', [id])
    if (!cookie) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && cookie.user_id !== payload.userId) {
      throw new ApiError(403, '无权访问此账号')
    }

    const [aiSettings, defaultReply] = await Promise.all([
      db.get('SELECT * FROM ai_reply_settings WHERE cookie_id = ?', [id]),
      db.get('SELECT * FROM default_replies WHERE cookie_id = ?', [id]),
    ])

    return ok({
      cookie: {
        ...cookie,
        auto_confirm: Number(cookie.auto_confirm ?? 1),
        pause_duration: Number(cookie.pause_duration ?? 10),
        show_browser: Number(cookie.show_browser ?? 0),
      },
      aiSettings: aiSettings || null,
      defaultReply: defaultReply || null,
    })
  }),
)
