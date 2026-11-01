/** GET /api/admin/roles — 角色列表 (含授权菜单 ID 与用户数)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const roles = await db.all(
      `SELECT r.id, r.name, r.description, r.is_system, r.created_at, r.updated_at,
              (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count,
              (SELECT COUNT(*) FROM role_menus rm WHERE rm.role_id = r.id) AS menu_count
       FROM roles r ORDER BY r.id`,
    )
    const grants = await db.all<{ role_id: number; menu_id: number }>('SELECT role_id, menu_id FROM role_menus')
    const byRole = new Map<number, number[]>()
    for (const g of grants) {
      const list = byRole.get(g.role_id) || []
      list.push(g.menu_id)
      byRole.set(g.role_id, list)
    }
    return ok({
      items: (roles as any[]).map((r) => ({ ...r, menu_ids: byRole.get(r.id) || [] })),
    })
  }),
)
