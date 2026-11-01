/** GET /api/admin/menus — 全量菜单 (平铺+树), 菜单管理页消费。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT id, parent_id, name, path, icon, group_name, sort_order, admin_only, enabled, created_at, updated_at
       FROM menus ORDER BY sort_order, id`,
    )
    return ok({ items: rows, tree: buildMenuTree(rows as any) })
  }),
)
