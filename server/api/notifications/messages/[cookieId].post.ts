/** POST /api/notifications/messages/:cookieId — upsert a message-notification (toggle enabled). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    if (!cookieId) throw new ApiError(400, '缺少 cookie_id')
    const body = await readBody(event) || {}
    const channelId = Number(body.channel_id)
    const enabled = body.enabled === false || body.enabled === 0 ? 0 : 1

    if (!channelId) throw new ApiError(400, '缺少 channel_id')

    const db = await getDb()
    const [cookie, channel] = await Promise.all([
      db.get('SELECT id FROM cookies WHERE id = ?', [cookieId]),
      db.get('SELECT id FROM notification_channels WHERE id = ?', [channelId]),
    ])
    if (!cookie) throw new ApiError(404, '账号不存在')
    if (!channel) throw new ApiError(404, '渠道不存在')

    const existing = await db.get(
      'SELECT id FROM message_notifications WHERE cookie_id = ? AND channel_id = ?',
      [cookieId, channelId],
    )

    let id: number | string
    if (existing) {
      await db.run(
        'UPDATE message_notifications SET enabled = ? WHERE id = ?',
        [enabled, existing.id],
      )
      id = existing.id
    } else {
      const r = await db.run(
        'INSERT INTO message_notifications (cookie_id, channel_id, enabled) VALUES (?, ?, ?)',
        [cookieId, channelId, enabled],
      )
      id = r.lastInsertId
    }

    return ok({ id, cookie_id: cookieId, channel_id: channelId, enabled }, enabled ? '已启用通知' : '已关闭通知')
  }),
)
