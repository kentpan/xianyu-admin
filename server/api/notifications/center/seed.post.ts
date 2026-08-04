/** POST /api/notifications/center/seed — seed demo notifications (for testing the notification center). */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    // Ensure table exists
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

    const demos = [
      { type: 'success', title: '系统安装完成', message: '闲鱼超级管家已成功初始化，欢迎使用！', link: '/dashboard' },
      { type: 'info', title: '功能更新', message: '新增 7 天订单趋势图、全局搜索(Cmd+K) 等功能', link: '/about' },
      { type: 'warning', title: '安全提醒', message: '请定期更换管理员密码，确保账号安全', link: '/settings' },
      { type: 'info', title: '数据库状态', message: '当前使用 SQLite 驱动，可在设置中切换 MySQL/D1', link: '/settings' },
    ]

    for (const d of demos) {
      await db.run(
        'INSERT INTO in_app_notifications (user_id, type, title, message, read, link) VALUES (?, ?, ?, ?, 0, ?)',
        [payload.userId, d.type, d.title, d.message, d.link],
      ).catch(() => {})
    }

    return ok({ seeded: demos.length }, `已生成 ${demos.length} 条演示通知`)
  }),
)
