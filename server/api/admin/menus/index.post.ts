/** POST /api/admin/menus — 新增菜单 (树状节点)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const name = String(body.name || '').trim()
    const path = String(body.path || '').trim()
    if (!name) throw new ApiError(400, '菜单名称不能为空')
    if (!path || !path.startsWith('/')) throw new ApiError(400, '菜单路径必须以 / 开头')
    const parent_id = Math.max(Number(body.parent_id) || 0, 0)
    if (parent_id) {
      const db0 = await getDb()
      const parent = await db0.get('SELECT id FROM menus WHERE id = ?', [parent_id])
      if (!parent) throw new ApiError(400, '父级菜单不存在')
    }
    const db = await getDb()
    const dup = await db.get('SELECT id FROM menus WHERE path = ?', [path])
    if (dup) throw new ApiError(400, `菜单路径已存在: ${path}`)
    // 分组真源 = menu_groups 表 (分组配置页可增删), 不再限死三个内置 key
    const groupKey = String(body.group_name || 'main').trim() || 'main'
    const groupExists = await db.get('SELECT id FROM menu_groups WHERE key = ?', [groupKey])
    if (!groupExists) throw new ApiError(400, `分组不存在: ${groupKey} (先到「分组配置」新增)`)
    await db.run(
      `INSERT INTO menus (parent_id, name, path, icon, group_name, sort_order, admin_only, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parent_id,
        name,
        path,
        String(body.icon || 'dashboard'),
        groupKey,
        Math.max(Number(body.sort_order) || 0, 0),
        body.admin_only ? 1 : 0,
        body.enabled === undefined ? 1 : body.enabled ? 1 : 0,
      ],
    )
    const row = await db.get('SELECT id FROM menus WHERE path = ?', [path])
    return ok({ id: row?.id }, '菜单已创建')
  }),
)
