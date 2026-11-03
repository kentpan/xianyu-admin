/** GET /api/admin/menus — 全量菜单 (平铺+树) + 分组列表, 菜单管理页消费。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT id, parent_id, name, path, icon, group_name, sort_order, admin_only, enabled, created_at, updated_at
       FROM menus ORDER BY sort_order, id`,
    )
    const groups = await getMenuGroups(db)
    return ok({ items: rows, tree: buildMenuTree(rows as any), groups })
  }),
)
