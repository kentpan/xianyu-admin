/** POST /api/notifications/center/read — mark notification(s) as read. Body: { id?: number, all?: boolean }
 *
 * (v2.3.5 hotfix) 写后按用户前缀失效通知中心缓存, 未读徽标立即真实。 */
import { invalidateDbCache } from '../../../utils/db-cache'
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const body = await readBody(event)
    const db = await getDb()

    if (body?.all) {
      await db.run('UPDATE in_app_notifications SET read=1 WHERE user_id=?', [payload.userId]).catch(() => {})
      invalidateDbCache(`notif:center:${payload.userId}`)
      return ok({}, '已全部标记为已读')
    }

    if (body?.id) {
      await db.run('UPDATE in_app_notifications SET read=1 WHERE id=? AND user_id=?', [body.id, payload.userId]).catch(() => {})
      invalidateDbCache(`notif:center:${payload.userId}`)
      return ok({}, '已标记为已读')
    }
    throw new ApiError(400, '请指定通知 ID')
  }),
)
