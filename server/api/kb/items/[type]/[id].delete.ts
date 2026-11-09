/**
 * DELETE /api/kb/items/:type/:id — 删除知识库条目 (编辑模式/浏览模式移除, v2.3.0)。
 * 同时清理该条目在所有分组中的成员映射。type: 'question' | 'answer'
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const type = getRouterParam(event, 'type') === 'answer' ? 'answer' : 'question'
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '缺少条目 ID')
    const table = type === 'answer' ? 'kb_answers' : 'kb_questions'
    const r = await db.run(`DELETE FROM ${table} WHERE id = ?`, [id])
    if (!Number(r?.changes || 0)) throw new ApiError(404, '条目不存在')
    await db.run('DELETE FROM kb_group_members WHERE item_type = ? AND item_id = ?', [type, id]).catch(() => {})
    return ok({ id }, '已删除')
  }),
)
