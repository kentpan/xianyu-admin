/**
 * DELETE /api/kb/groups/:id — 删除分组 (v2.4.0)。
 * 删除分组及其商品成员映射 (kb_group_items), 商品本身与消息数据不受影响。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '缺少分组 ID')
    const r = await db.run('DELETE FROM kb_groups WHERE id = ?', [id])
    if (!Number(r?.changes || 0)) throw new ApiError(404, '分组不存在')
    await db.run('DELETE FROM kb_group_items WHERE group_id = ?', [id]).catch(() => {})
    return ok({ id }, '分组已删除 (商品与消息数据保留)')
  }),
)
