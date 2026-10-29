/** DELETE /api/notifications/channels/:id — delete a channel (and its message_notifications rows). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的渠道 ID')
    const db = await getDb()
    await db.transaction(async () => {
      await db.run('DELETE FROM message_notifications WHERE channel_id = ?', [id])
      const r = await db.run('DELETE FROM notification_channels WHERE id = ?', [id])
      if (!r.changes) throw new ApiError(404, '渠道不存在')
    })
    return ok({ id }, '渠道已删除')
  }),
)
