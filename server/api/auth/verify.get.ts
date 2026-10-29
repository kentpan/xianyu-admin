/** GET /api/auth/verify — validate current token, return user info. */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const user = await db.get<{ id: number; username: string; is_admin: number; email: string; is_active: number }>(
      'SELECT id, username, is_admin, email, is_active FROM users WHERE id = ?',
      [payload.userId],
    )
    if (!user || !user.is_active) throw new ApiError(401, '用户不存在或已禁用')
    return ok({
      authenticated: true,
      user_id: user.id,
      username: user.username,
      is_admin: !!user.is_admin,
      email: user.email,
    })
  }),
)
