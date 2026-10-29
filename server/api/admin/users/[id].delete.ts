/** DELETE /api/admin/users/:id — delete a user (prevent deleting last admin or self). */
export default defineEventHandler(
  withApi(async (event) => {
    const me = requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的用户 ID')
    if (id === me.userId) throw new ApiError(400, '不能删除自己')
    const db = await getDb()

    const user = await db.get('SELECT is_admin FROM users WHERE id = ?', [id])
    if (!user) throw new ApiError(404, '用户不存在')
    if (user.is_admin) {
      const cnt = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM users WHERE is_admin = 1')
      if ((cnt?.c || 0) <= 1) throw new ApiError(400, '不能删除最后一个管理员')
    }
    await db.run('DELETE FROM users WHERE id = ?', [id])
    return ok({ id }, '用户已删除')
  }),
)
