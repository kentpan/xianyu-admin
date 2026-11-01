/**
 * PUT /api/admin/menu-groups/:id — 更新分组 (label/sort_order; 自定义组可改 key, 级联同步 menus.group_name)。
 * 内置组 (main/admin/bottom) key 不可改 — 侧边栏/权限判定语义锚点。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的分组 ID')
    const body = await readBody(event) || {}
    const db = await getDb()
    const row = await db.get<{ id: number; key: string; is_system: number }>(
      'SELECT id, key, is_system FROM menu_groups WHERE id = ?',
      [id],
    )
    if (!row) throw new ApiError(404, '分组不存在')

    const fields: string[] = []
    const params: any[] = []
    if (body.label !== undefined) {
      const label = String(body.label).trim()
      if (!label) throw new ApiError(400, '分组名称不能为空')
      const dupLabel = await db.get('SELECT id FROM menu_groups WHERE label = ? AND id != ?', [label, id])
      if (dupLabel) throw new ApiError(400, `分组名称已存在: ${label}`)
      fields.push('label = ?')
      params.push(label)
    }
    if (body.sort_order !== undefined) {
      fields.push('sort_order = ?')
      params.push(Math.max(Number(body.sort_order) || 0, 0))
    }
    if (body.key !== undefined && String(body.key).trim() !== row.key) {
      if (Number(row.is_system) === 1) throw new ApiError(400, `内置分组 key 不可修改: ${row.key}`)
      const newKey = String(body.key).trim()
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(newKey)) {
        throw new ApiError(400, '分组 key 必须以小写字母开头, 仅含小写字母/数字/下划线, 最长 32 字符')
      }
      const dupKey = await db.get('SELECT id FROM menu_groups WHERE key = ? AND id != ?', [newKey, id])
      if (dupKey) throw new ApiError(400, `分组 key 已存在: ${newKey}`)
      fields.push('key = ?')
      params.push(newKey)
      // 级联: 挂在该组下的菜单同步迁移到新 key (菜单行 group_name 引用分组 key)
      await db.run('UPDATE menus SET group_name = ?, updated_at = CURRENT_TIMESTAMP WHERE group_name = ?', [newKey, row.key])
    }
    if (!fields.length) throw new ApiError(400, '没有需要更新的字段')
    params.push(id)
    await db.run(`UPDATE menu_groups SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)
    return ok({ id }, '分组已更新')
  }),
)
