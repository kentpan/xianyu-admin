/** GET /api/admin/menu-groups — 菜单分组列表 (含每组菜单数), 分组配置弹窗/菜单页分组显示消费。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const groups = await getMenuGroups(db)
    const counts = await db
      .all<{ group_name: string; c: number }>('SELECT group_name, COUNT(*) as c FROM menus GROUP BY group_name')
      .catch(() => [])
    const countMap = new Map(counts.map((r) => [r.group_name, Number(r.c)]))
    return ok({
      items: groups.map((g) => ({ ...g, menu_count: countMap.get(g.key) || 0 })),
    })
  }),
)
