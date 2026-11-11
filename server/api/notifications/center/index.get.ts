/** GET /api/notifications/center — list in-app notifications for current user. */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const { page = 1, pageSize = 20 } = getQuery(event) as any
    const offset = ((Number(page) || 1) - 1) * (Number(pageSize) || 20)

    const rows = await db.all(
      'SELECT id, type, title, message, read, link, created_at FROM in_app_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [payload.userId, Number(pageSize) || 20, offset],
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

    // (v2.3.13) unread/total 改读 user_notification_state 计数器单行 (O(1)):
    // 原两条 COUNT(*) 每次轮询扫全部通知行, 是云端日行读取限额的最大消耗;
    // 计数器由全部写入点 (notify/seed/read) 同笔维护, initSchema 对存量库一次性回填。
    // 行缺失 = 该用户尚无任何通知 = 0/0, 语义精确
    const state = await db
      .get<{ total: number; unread: number }>(
        'SELECT total, unread FROM user_notification_state WHERE user_id=?',
        [payload.userId],
      )
      .catch(() => null)

    return ok({
      items: rows,
      total: Number(state?.total || 0),
      unread: Number(state?.unread || 0),
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    })
  }),
)
