/** DELETE /api/admin/roles/:id — 删除角色 (内置角色不可删; 级联清理授权与用户挂载)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的角色 ID')
    const db = await getDb()
    const role = await db.get<{ id: number; is_system: number }>('SELECT id, is_system FROM roles WHERE id = ?', [id])
    if (!role) throw new ApiError(404, '角色不存在')
    if (Number(role.is_system) === 1) throw new ApiError(400, '内置角色不可删除')
    await db.run('DELETE FROM role_menus WHERE role_id = ?', [id])
    await db.run('DELETE FROM user_roles WHERE role_id = ?', [id])
    await db.run('DELETE FROM roles WHERE id = ?', [id])
    return ok({ id }, '角色已删除')
  }),
)
