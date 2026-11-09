/**
 * DELETE /api/kb/groups/:id — 删除分组 (v2.3.0)。
 * 仅删除分组与映射, 组内问话/回答条目保留在知识库中 (不级联删除内容)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '缺少分组 ID')
    const r = await db.run('DELETE FROM kb_groups WHERE id = ?', [id])
    if (!Number(r?.changes || 0)) throw new ApiError(404, '分组不存在')
    await db.run('DELETE FROM kb_group_members WHERE group_id = ?', [id]).catch(() => {})
    return ok({ id }, '分组已删除 (组内问答保留)')
  }),
)
