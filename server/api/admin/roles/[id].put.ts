/** PUT /api/admin/roles/:id — 更新角色 (名称/描述/菜单授权; 内置超级管理员的菜单授权不可改)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的角色 ID')
    const body = await readBody(event) || {}
    const db = await getDb()
    const role = await db.get<{ id: number; name: string; is_system: number }>('SELECT id, name, is_system FROM roles WHERE id = ?', [id])
    if (!role) throw new ApiError(404, '角色不存在')

    const fields: string[] = []
    const params: any[] = []
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) throw new ApiError(400, '角色名称不能为空')
      const dup = await db.get('SELECT id FROM roles WHERE name = ? AND id != ?', [name, id])
      if (dup) throw new ApiError(400, `角色名称已存在: ${name}`)
      fields.push('name = ?'); params.push(name)
    }
    if (body.description !== undefined) { fields.push('description = ?'); params.push(String(body.description)) }
    if (fields.length) {
      params.push(id)
      await db.run(`UPDATE roles SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)
    }

    if (body.menu_ids !== undefined) {
      // 超级管理员永远是全量菜单 (seedRbac 幂等跟随), 改它的授权无意义, 明确拒绝防误配锁权限
      if (Number(role.is_system) === 1 && role.name === '超级管理员') {
        throw new ApiError(400, '超级管理员自动拥有全部菜单, 无需配置授权')
      }
      const menuIds = Array.isArray(body.menu_ids) ? body.menu_ids.map((v: any) => Number(v)).filter((v: number) => v > 0) : []
      await db.run('DELETE FROM role_menus WHERE role_id = ?', [id])
      for (const mid of menuIds) {
        await db.run('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)', [id, mid]).catch(() => {})
      }
    }
    return ok({ id }, '角色已更新')
  }),
)
