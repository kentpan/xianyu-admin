/**
 * DELETE /api/admin/menu-groups/:id — 删除分组。
 * 内置组 (main/admin/bottom) 不可删; 组下仍有菜单时拒绝 (需先把菜单移到其他分组), 绝不静默丢菜单。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的分组 ID')
    const db = await getDb()
    const row = await db.get<{ id: number; key: string; label: string; is_system: number }>(
      'SELECT id, key, label, is_system FROM menu_groups WHERE id = ?',
      [id],
    )
    if (!row) throw new ApiError(404, '分组不存在')
    if (Number(row.is_system) === 1) throw new ApiError(400, `内置分组不可删除: ${row.label}`)
    const inUse = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM menus WHERE group_name = ?', [row.key])
    if (Number(inUse?.c || 0) > 0) {
      throw new ApiError(400, `分组「${row.label}」下仍有 ${inUse.c} 个菜单, 请先在菜单列表把它们移到其他分组`)
    }
    await db.run('DELETE FROM menu_groups WHERE id = ?', [id])
    return ok({ id }, '分组已删除')
  }),
)
