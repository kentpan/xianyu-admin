/**
 * POST /api/kb/groups/:id/members — 分组成员管理 (v2.3.0)。
 * Body: { action: 'add'|'remove', item_type: 'question'|'answer', item_id }
 * 浏览模式点击分组名 → 查看关联问答; 编辑模式勾选/取消勾选问话与回答加入分组。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const groupId = Number(getRouterParam(event, 'id'))
    if (!groupId) throw new ApiError(400, '缺少分组 ID')
    const body = await readBody(event).catch(() => ({}))
    const action = String(body?.action) === 'remove' ? 'remove' : 'add'
    const itemType = String(body?.item_type) === 'answer' ? 'answer' : 'question'
    const itemId = Number(body?.item_id)
    if (!itemId) throw new ApiError(400, '缺少条目 ID')

    const group = await db.get<{ id: number }>('SELECT id FROM kb_groups WHERE id = ?', [groupId])
    if (!group) throw new ApiError(404, '分组不存在')

    if (action === 'add') {
      const table = itemType === 'answer' ? 'kb_answers' : 'kb_questions'
      const ex = await db.get(`SELECT id FROM ${table} WHERE id = ?`, [itemId]).catch(() => null)
      if (!ex) throw new ApiError(404, `${itemType === 'answer' ? '回答' : '问话'}条目不存在`)
      await db.run(
        'INSERT INTO kb_group_members (group_id, item_type, item_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        [groupId, itemType, itemId],
      )
      return ok({ groupId, itemId }, '已加入分组')
    }
    await db.run('DELETE FROM kb_group_members WHERE group_id = ? AND item_type = ? AND item_id = ?', [groupId, itemType, itemId])
    return ok({ groupId, itemId }, '已从分组移除')
  }),
)
