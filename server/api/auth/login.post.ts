/**
 * POST /api/auth/login — username/password login.
 */
export default defineEventHandler(
  withApi(async (event) => {
    if (!isInstalled()) throw new ApiError(503, '系统未安装')
    const body = await readBody(event)
    const { username, password } = body || {}
    if (!username || !password) throw new ApiError(400, '用户名和密码不能为空')

    const adminSecret = getRuntimeState().adminSecret
    const sentSecret = getHeader(event, 'x-admin-secret')
    if (sentSecret && adminSecret && sentSecret !== adminSecret) {
      throw new ApiError(401, '管理密钥不正确')
    }

    const db = await getDb()
    const user = await db.get<{ id: number; username: string; password_hash: string; is_admin: number; is_active: number; email: string }>(
      'SELECT id, username, password_hash, is_admin, is_active, email FROM users WHERE username = ?',
      [username],
    )
    if (!user) throw new ApiError(401, '用户名或密码错误')
    if (!user.is_active) throw new ApiError(403, '账号已被禁用')
    if (!verifyPassword(password, user.password_hash)) {
      throw new ApiError(401, '用户名或密码错误')
    }

    const token = signToken({ userId: user.id, username: user.username, isAdmin: !!user.is_admin })
    setCookie(event, 'admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    await setSystemSetting('last_login_at', new Date().toISOString(), '最近登录时间').catch(() => {})
    await auditLog(event, { action: 'login', module: 'auth', targetType: 'user', targetId: user.id, desc: `用户 ${user.username} 登录` }).catch(() => {})

    return ok(
      {
        token,
        user: {
          user_id: user.id,
          username: user.username,
          is_admin: !!user.is_admin,
          email: user.email,
        },
      },
      '登录成功',
    )
  }),
)
