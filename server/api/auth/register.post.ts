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
    const token = signToken({ userId: Number(result.lastInsertId), username, isAdmin: false })
    setCookie(event, 'admin_token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 })
    return ok({ token, user: { user_id: Number(result.lastInsertId), username, is_admin: false, email } }, '注册成功')
  }),
)
