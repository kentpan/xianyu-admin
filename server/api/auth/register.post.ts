/** POST /api/auth/register — registration gated by system_settings.registration_enabled. */
export default defineEventHandler(
  withApi(async (event) => {
    const settings = await getPublicSettings()
    if (!settings.registration_enabled) {
      throw new ApiError(403, '当前系统已关闭注册')
    }
    const body = await readBody(event)
    const { username, email, password } = body || {}
    if (!username || !email || !password) throw new ApiError(400, '用户名、邮箱、密码均不能为空')
    if (password.length < 6) throw new ApiError(400, '密码至少 6 位')

    const db = await getDb()
    const exists = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email])
    if (exists) throw new ApiError(409, '用户名或邮箱已存在')

    const result = await db.run(
      'INSERT INTO users (username, email, password_hash, is_active, is_admin) VALUES (?, ?, ?, 1, 0)',
      [username, email, hashPassword(password)],
    )
    // (v2.1.14) RBAC: 新用户默认挂「普通用户」角色 — 无角色的用户在菜单级权限校验下
    // 只能停留在工作台, 注册链路必须补默认授权 (与 seedRbac 存量用户兜底同语义)
    try {
      const defRole = await db.get<{ id: number }>(`SELECT id FROM roles WHERE name = '普通用户'`)
      if (defRole) {
        await db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [
          Number(result.lastInsertId),
          defRole.id,
        ])
      }
    } catch { /* 角色表未就绪时不阻塞注册 */ }
    const token = signToken({ userId: Number(result.lastInsertId), username, isAdmin: false })
    setCookie(event, 'admin_token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 })
    return ok({ token, user: { user_id: Number(result.lastInsertId), username, is_admin: false, email } }, '注册成功')
  }),
)
