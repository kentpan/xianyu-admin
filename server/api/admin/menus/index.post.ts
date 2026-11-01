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
    await db.run(
      `INSERT INTO menus (parent_id, name, path, icon, group_name, sort_order, admin_only, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parent_id,
        name,
        path,
        String(body.icon || 'dashboard'),
        ['main', 'admin', 'bottom'].includes(String(body.group_name)) ? String(body.group_name) : 'main',
        Math.max(Number(body.sort_order) || 0, 0),
        body.admin_only ? 1 : 0,
        body.enabled === undefined ? 1 : body.enabled ? 1 : 0,
      ],
    )
    const row = await db.get('SELECT id FROM menus WHERE path = ?', [path])
    return ok({ id: row?.id }, '菜单已创建')
  }),
)
