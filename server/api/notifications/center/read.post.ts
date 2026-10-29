/** POST /api/notifications/center/read — mark notification(s) as read. Body: { id?: number, all?: boolean } */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const body = await readBody(event)
    const db = await getDb()

    if (body?.all) {
      await db.run('UPDATE in_app_notifications SET read=1 WHERE user_id=?', [payload.userId]).catch(() => {})
      return ok({}, '已全部标记为已读')
    }

    if (body?.id) {
      await db.run('UPDATE in_app_notifications SET read=1 WHERE id=? AND user_id=?', [body.id, payload.userId]).catch(() => {})
      return ok({}, '已标记为已读')
    }
    throw new ApiError(400, '请指定通知 ID')
  }),
)
