/** POST /api/notifications/center/read — mark notification(s) as read. Body: { id?: number, all?: boolean } */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const body = await readBody(event)
    const db = await getDb()

    if (body?.all) {
      // (v2.3.13) 加 read=0 条件: changes 即本次真实未读转已读数
      await db.run('UPDATE in_app_notifications SET read=1 WHERE user_id=? AND read=0', [payload.userId]).catch(() => {})
      // 计数器同笔维护: 全部已读后未读必为 0, 单行写精确置零
      await db
        .run('UPDATE user_notification_state SET unread = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id=?', [payload.userId])
        .catch(() => {})
      return ok({}, '已全部标记为已读')
    }

    if (body?.id) {
      // (v2.3.13) 加 read=0 条件: changes=1 才是真未读转已读, 计数器精确减 1 (原本已读不动)
      const r = await db
        .run('UPDATE in_app_notifications SET read=1 WHERE id=? AND user_id=? AND read=0', [body.id, payload.userId])
        .catch(() => null)
      if (r && r.changes > 0) {
        await db
          .run('UPDATE user_notification_state SET unread = MAX(0, unread - 1), updated_at = CURRENT_TIMESTAMP WHERE user_id=?', [payload.userId])
          .catch(() => {})
      }
      return ok({}, '已标记为已读')
    }
    throw new ApiError(400, '请指定通知 ID')
  }),
)
