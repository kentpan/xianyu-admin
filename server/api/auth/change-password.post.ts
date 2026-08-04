/** POST /api/auth/change-password — change current user's password. */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const body = await readBody(event)
    const { currentPassword, newPassword } = body || {}
    if (!currentPassword || !newPassword) throw new ApiError(400, '请填写当前密码和新密码')
    if (newPassword.length < 6) throw new ApiError(400, '新密码至少 6 位')

    const db = await getDb()
    const user = await db.get<{ id: number; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE id = ?',
      [payload.userId],
    )
    if (!user) throw new ApiError(404, '用户不存在')
    if (!verifyPassword(currentPassword, user.password_hash)) {
      throw new ApiError(401, '当前密码不正确')
    }

    await db.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      hashPassword(newPassword),
      payload.userId,
    ])

    return ok({}, '密码修改成功')
  }),
)
