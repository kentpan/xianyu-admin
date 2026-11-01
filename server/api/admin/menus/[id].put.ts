/** PUT /api/admin/menus/:id — 更新菜单 (名称/路径/图标/分组/排序/父级/仅管理员/启用)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的菜单 ID')
    const body = await readBody(event) || {}
    const db = await getDb()
    const row = await db.get('SELECT id FROM menus WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '菜单不存在')

    const fields: string[] = []
    const params: any[] = []
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) throw new ApiError(400, '菜单名称不能为空')
      fields.push('name = ?'); params.push(name)
    }
    if (body.path !== undefined) {
      const path = String(body.path).trim()
      if (!path || !path.startsWith('/')) throw new ApiError(400, '菜单路径必须以 / 开头')
      const dup = await db.get('SELECT id FROM menus WHERE path = ? AND id != ?', [path, id])
      if (dup) throw new ApiError(400, `菜单路径已存在: ${path}`)
      fields.push('path = ?'); params.push(path)
    }
    if (body.icon !== undefined) { fields.push('icon = ?'); params.push(String(body.icon)) }
    if (body.group_name !== undefined) {
      fields.push('group_name = ?')
      params.push(['main', 'admin', 'bottom'].includes(String(body.group_name)) ? String(body.group_name) : 'main')
    }
    if (body.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(Math.max(Number(body.sort_order) || 0, 0)) }
    if (body.parent_id !== undefined) {
      const parentId = Math.max(Number(body.parent_id) || 0, 0)
      if (parentId === id) throw new ApiError(400, '父级菜单不能是自身')
      if (parentId) {
        const parent = await db.get('SELECT id FROM menus WHERE id = ?', [parentId])
        if (!parent) throw new ApiError(400, '父级菜单不存在')
      }
      fields.push('parent_id = ?'); params.push(parentId)
    }
    if (body.admin_only !== undefined) { fields.push('admin_only = ?'); params.push(body.admin_only ? 1 : 0) }
    if (body.enabled !== undefined) { fields.push('enabled = ?'); params.push(body.enabled ? 1 : 0) }
    if (!fields.length) throw new ApiError(400, '没有需要更新的字段')

    params.push(id)
    await db.run(`UPDATE menus SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)
    return ok({ id }, '菜单已更新')
  }),
)
