/** PUT /api/admin/users/:id — toggle is_active / is_admin. */
export default defineEventHandler(
  withApi(async (event) => {
    const me = requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的用户 ID')
    const body = await readBody(event) || {}
    const db = await getDb()

    const user = await db.get('SELECT id, is_admin FROM users WHERE id = ?', [id])
    if (!user) throw new ApiError(404, '用户不存在')

    const fields: string[] = []
    const params: any[] = []
    if (body.is_active !== undefined) { fields.push('is_active = ?'); params.push(body.is_active ? 1 : 0) }
    if (body.is_admin !== undefined) {
      // Prevent removing admin from the last admin
      if (id === me.userId && !body.is_admin) {
        const cnt = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM users WHERE is_admin = 1')
        if ((cnt?.c || 0) <= 1) throw new ApiError(400, '不能取消自己最后一个管理员权限')
      }
      if (!body.is_admin) {
        const cnt = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM users WHERE is_admin = 1')
        if ((cnt?.c || 0) <= 1) throw new ApiError(400, '系统至少需要保留一个管理员')
      }
      fields.push('is_admin = ?'); params.push(body.is_admin ? 1 : 0)
    }
    if (!fields.length) throw new ApiError(400, '没有需要更新的字段')

    params.push(id)
    await db.run(`UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)
    return ok({ id }, '用户已更新')
  }),
)
