/**
 * POST /api/kb/groups — 创建商品分组 (v2.4.0)。
 * Body: { name }
 * 分组 = 商品组: 成员 (商品) 由 /api/kb/group-items 单独管理, 建组时为空。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const name = String(body?.name || '').trim()
    if (!name) throw new ApiError(400, '分组名称为空')
    if (name.length > 128) throw new ApiError(400, '分组名称过长')
    const dup = await db.get<{ id: number }>('SELECT id FROM kb_groups WHERE name = ?', [name]).catch(() => null)
    if (dup) throw new ApiError(409, '已存在同名分组')

    const maxSort = await db.get<{ m: number }>('SELECT COALESCE(MAX(sort), 0) m FROM kb_groups').catch(() => ({ m: 0 }))
    const r = await db.run('INSERT INTO kb_groups (name, sort) VALUES (?, ?)', [name, Number(maxSort?.m || 0) + 1])
    const groupId = Number(r?.lastInsertId || 0)
    return ok({ id: groupId }, `分组「${name}」已创建`)
  }),
)
