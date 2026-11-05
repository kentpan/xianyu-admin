/**
 * PUT /api/kb/groups/:id — 分组改名 (可自定义分组名称, v2.3.0)。Body: { name }
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '缺少分组 ID')
    const body = await readBody(event).catch(() => ({}))
    const name = String(body?.name || '').trim()
    if (!name) throw new ApiError(400, '分组名称为空')
    const dup = await db.get<{ id: number }>('SELECT id FROM kb_groups WHERE name = ? AND id != ?', [name, id]).catch(() => null)
    if (dup) throw new ApiError(409, '已存在同名分组')
    const r = await db.run('UPDATE kb_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, id])
    if (!Number(r?.changes || 0)) throw new ApiError(404, '分组不存在')
    return ok({ id }, '分组已更新')
  }),
)
