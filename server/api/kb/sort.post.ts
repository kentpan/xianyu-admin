/**
 * POST /api/kb/sort — 调整分组排序 (v2.4.0)。
 * Body: { id, direction: 'up'|'down' }
 *
 * sort 即分组展示顺序 (升序)。分组成员是商品 (kb_group_items), 问答条目排序已随
 * 商品分组模型移除。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const id = Number(body?.id)
    const direction = String(body?.direction) === 'down' ? 'down' : 'up'
    if (!id) throw new ApiError(400, '缺少分组 ID')

    const cur = await db.get<{ id: number; sort: number }>('SELECT id, sort FROM kb_groups WHERE id = ?', [id])
    if (!cur) throw new ApiError(404, '分组不存在')
    // 相邻分组: up = sort 比当前小的最大者; down = sort 比当前大的最小者 (再按 id 稳定序)
    const neighbor =
      direction === 'up'
        ? await db.get<{ id: number; sort: number }>(
            'SELECT id, sort FROM kb_groups WHERE sort < ? OR (sort = ? AND id < ?) ORDER BY sort DESC, id DESC LIMIT 1',
            [cur.sort, cur.sort, cur.id],
          )
        : await db.get<{ id: number; sort: number }>(
            'SELECT id, sort FROM kb_groups WHERE sort > ? OR (sort = ? AND id > ?) ORDER BY sort ASC, id ASC LIMIT 1',
            [cur.sort, cur.sort, cur.id],
          )
    if (!neighbor) return ok({ moved: false }, direction === 'up' ? '已在最前' : '已在最后')
    await db.run('UPDATE kb_groups SET sort = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [neighbor.sort, cur.id])
    await db.run('UPDATE kb_groups SET sort = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cur.sort, neighbor.id])
    return ok({ moved: true }, '分组排序已更新')
  }),
)
