/** POST /api/admin/menu-groups — 新增菜单分组 (key 唯一, 侧边栏分组标题/排序可配置)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const key = String(body.key || '').trim()
    const label = String(body.label || '').trim()
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) {
      throw new ApiError(400, '分组 key 必须以小写字母开头, 仅含小写字母/数字/下划线, 最长 32 字符')
    }
    if (!label) throw new ApiError(400, '分组名称不能为空')
    const db = await getDb()
    const dup = await db.get('SELECT id FROM menu_groups WHERE key = ?', [key])
    if (dup) throw new ApiError(400, `分组 key 已存在: ${key}`)
    const dupLabel = await db.get('SELECT id FROM menu_groups WHERE label = ?', [label])
    if (dupLabel) throw new ApiError(400, `分组名称已存在: ${label}`)
    await db.run('INSERT INTO menu_groups (key, label, is_system, sort_order) VALUES (?, ?, 0, ?)', [
      key,
      label,
      Math.max(Number(body.sort_order) || 0, 0),
    ])
    const row = await db.get<{ id: number }>('SELECT id FROM menu_groups WHERE key = ?', [key])
    return ok({ id: row?.id }, '分组已创建')
  }),
)
