/**
 * GET/PUT /api/user/profile — user profile & preferences.
 * GET: returns user info + preferences (from user_settings table).
 * PUT: updates preferences (theme, sidebar collapsed default, etc).
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    if (getMethod(event) === 'GET') {
      const user = await db.get<{ id: number; username: string; email: string; is_admin: number; is_active: number; created_at: string }>(
        'SELECT id, username, email, is_admin, is_active, created_at FROM users WHERE id = ?',
        [payload.userId],
      )
      if (!user) throw new ApiError(404, '用户不存在')

      const settings = await db.all<{ key_name: string; value: string }>(
        'SELECT key_name, value FROM user_settings WHERE user_id = ?',
        [payload.userId],
      ).catch(() => [])
      const prefs: Record<string, any> = {}
      for (const s of settings) {
        let v: any = s.value
        if (v === 'true') v = true
        else if (v === 'false') v = false
        prefs[s.key_name] = v
      }

      return ok({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          is_admin: !!user.is_admin,
          is_active: !!user.is_active,
          created_at: user.created_at,
        },
        preferences: {
          theme: prefs.theme || 'light',
          sidebar_default_collapsed: prefs.sidebar_default_collapsed ?? false,
          notification_sound: prefs.notification_sound ?? true,
          items_per_page: prefs.items_per_page ?? 20,
        },
      })
    }

    if (getMethod(event) === 'PUT') {
      const body = await readBody(event)
      const { preferences } = body || {}
      if (!preferences || typeof preferences !== 'object') throw new ApiError(400, '偏好设置格式无效')

      await db.exec(`CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key_name VARCHAR(64) NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, key_name)
      )`).catch(() => {})

      let updated = 0
      for (const [key, val] of Object.entries(preferences)) {
        const strVal = String(val)
        const existing = await db.get('SELECT id FROM user_settings WHERE user_id=? AND key_name=?', [payload.userId, key])
        if (existing) {
          await db.run('UPDATE user_settings SET value=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND key_name=?', [strVal, payload.userId, key])
        } else {
          await db.run('INSERT INTO user_settings (user_id, key_name, value) VALUES (?, ?, ?)', [payload.userId, key, strVal])
        }
        updated++
      }

      return ok({ updated }, '偏好设置已保存')
    }
  }),
)
