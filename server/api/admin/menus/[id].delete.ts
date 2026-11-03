/** DELETE /api/admin/menus/:id — 删除菜单 (有子菜单时拒绝; 级联清理角色授权)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的菜单 ID')
    const db = await getDb()
    const row = await db.get('SELECT id FROM menus WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '菜单不存在')
    const child = await db.get('SELECT id FROM menus WHERE parent_id = ? LIMIT 1', [id])
    if (child) throw new ApiError(400, '该菜单存在子菜单, 请先删除或移出子菜单')
    await db.run('DELETE FROM role_menus WHERE menu_id = ?', [id])
    await db.run('DELETE FROM menus WHERE id = ?', [id])
    return ok({ id }, '菜单已删除')
  }),
)
