/** GET /api/notifications/center — list in-app notifications for current user.
 *
 * (v2.3.5 hotfix) TTL 缓存 60s/用户/分页: NotificationBell 每标签页轮询本接口,
 * 缓存折叠为每 isolate 每分钟 1 次; 标记已读后按用户前缀失效 (read.post.ts)。 */
import { cachedQuery } from '../../../utils/db-cache'

export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const { page = 1, pageSize = 20 } = getQuery(event) as any
    const pageN = Number(page) || 1
    const sizeN = Number(pageSize) || 20
    const offset = (pageN - 1) * sizeN

    return ok(await cachedQuery(`notif:center:${payload.userId}:${pageN}:${sizeN}`, 60_000, async () => {
    const db = await getDb()

    const rows = await db.all(
      'SELECT id, type, title, message, read, link, created_at FROM in_app_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [payload.userId, sizeN, offset],
    ).catch(async () => {
      // Table may not exist yet — create it
      await db.exec(`CREATE TABLE IF NOT EXISTS in_app_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type VARCHAR(32) DEFAULT 'info',
        title VARCHAR(255) NOT NULL,
        message TEXT,
        read INTEGER DEFAULT 0,
        link VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`).catch(() => {})
      return []
    })

    const totalRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM in_app_notifications WHERE user_id=?', [payload.userId]).catch(() => ({ c: 0 }))
    const unreadRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM in_app_notifications WHERE user_id=? AND read=0', [payload.userId]).catch(() => ({ c: 0 }))

    return {
      items: rows,
      total: totalRow?.c || 0,
      unread: unreadRow?.c || 0,
      page: pageN,
      pageSize: sizeN,
    }
    }))
  }),
)
