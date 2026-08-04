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

    const totalRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM in_app_notifications WHERE user_id=?', [payload.userId]).catch(() => ({ c: 0 }))
    const unreadRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM in_app_notifications WHERE user_id=? AND read=0', [payload.userId]).catch(() => ({ c: 0 }))

    return ok({
      items: rows,
      total: totalRow?.c || 0,
      unread: unreadRow?.c || 0,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    })
  }),
)
