/**
 * POST /api/kb/groups — 创建分组 (可自定义名称, v2.3.0)。
 * Body: { name, item_ids?: { questions?: number[], answers?: number[] } }
 * 建组时可一次性勾选问话/回答加入 (消息8: "创建新分组后可勾选类似问话和回答加入到分组")。
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

    // 勾选成员加入 (忽略不存在的条目)
    const qIds: number[] = Array.isArray(body?.item_ids?.questions) ? body.item_ids.questions.map(Number).filter(Boolean) : []
    const aIds: number[] = Array.isArray(body?.item_ids?.answers) ? body.item_ids.answers.map(Number).filter(Boolean) : []
    let added = 0
    for (const qid of qIds) {
      const ex = await db.get('SELECT id FROM kb_questions WHERE id = ?', [qid]).catch(() => null)
      if (!ex) continue
      await db.run(
        'INSERT INTO kb_group_members (group_id, item_type, item_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        [groupId, 'question', qid],
      )
      added++
    }
    for (const aid of aIds) {
      const ex = await db.get('SELECT id FROM kb_answers WHERE id = ?', [aid]).catch(() => null)
      if (!ex) continue
      await db.run(
        'INSERT INTO kb_group_members (group_id, item_type, item_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        [groupId, 'answer', aid],
      )
      added++
    }
    return ok({ id: groupId, added }, `分组「${name}」已创建${added ? `, 关联 ${added} 条问答` : ''}`)
  }),
)
