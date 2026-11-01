/** POST /api/admin/roles — 新建角色并授权菜单 (menu_ids 全量替换式写入)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const name = String(body.name || '').trim()
    if (!name) throw new ApiError(400, '角色名称不能为空')
    const db = await getDb()
    const dup = await db.get('SELECT id FROM roles WHERE name = ?', [name])
    if (dup) throw new ApiError(400, `角色名称已存在: ${name}`)
    await db.run('INSERT INTO roles (name, description, is_system) VALUES (?, ?, 0)', [name, String(body.description || '')])
    const role = await db.get<{ id: number }>('SELECT id FROM roles WHERE name = ?', [name])
    if (!role) throw new ApiError(500, '角色创建失败')
    const menuIds = Array.isArray(body.menu_ids) ? body.menu_ids.map((v: any) => Number(v)).filter((v: number) => v > 0) : []
    for (const mid of menuIds) {
      await db.run('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)', [role.id, mid]).catch(() => {})
    }
    return ok({ id: role.id, menu_ids: menuIds }, '角色已创建')
  }),
)
