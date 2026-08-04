/** DELETE /api/notifications/messages/:cookieId/:channelId — remove a single message-notification mapping. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const channelId = Number(getRouterParam(event, 'channelId'))
    if (!cookieId || !channelId) throw new ApiError(400, '缺少参数')

    const db = await getDb()
    const r = await db.run(
      'DELETE FROM message_notifications WHERE cookie_id = ? AND channel_id = ?',
      [cookieId, channelId],
    )
    if (!r.changes) throw new ApiError(404, '通知关系不存在')
    return ok({ cookie_id: cookieId, channel_id: channelId }, '已删除')
  }),
)
