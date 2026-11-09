/**
 * POST /api/kb/capture-remove — 消息管理页「✅ → +」toggle 移除 (v2.3.1)。
 * Body: { source_message_id, role?: 'question'|'answer', content? }
 *
 * 与 /api/kb/capture 成对: 消息管理页气泡外圈图标为 toggle 语义 —
 *   + (未添加, 棕黄圆) → 点击添加 → ✅ (已添加, 绿圆) → 再点击 → 移除回 +。
 * 查删顺序:
 *   1. 按 source_message_id 从 kb_questions / kb_answers 删除 (role 缺省两表都删);
 *   2. 兜底: 该消息无独立条目 (同内容被别的消息先沉淀, capture 去重只 freq+1) 时,
 *      若带 content 则按 content_hash 命中删除整条 — 同内容任意消息的 ✅ 都能正确移除。
 * 都会连带清理 kb_group_members 中的分组引用, 避免悬空成员。
 */
import crypto from 'node:crypto'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const sourceMessageId = String(body?.source_message_id || '').trim()
    if (!sourceMessageId) throw new ApiError(400, '缺少 source_message_id')
    const role = String(body?.role || '')
    const content = String(body?.content || '')

    const targets: Array<'question' | 'answer'> =
      role === 'question' ? ['question'] : role === 'answer' ? ['answer'] : ['question', 'answer']

    const hash =
      content
        ? crypto.createHash('sha256').update(String(content).replace(/\s+/g, ' ').trim()).digest('hex')
        : ''

    let removed = 0
    const removedIds: Array<{ type: 'question' | 'answer'; id: number }> = []
    for (const t of targets) {
      const table = t === 'answer' ? 'kb_answers' : 'kb_questions'
      // 1) 溯源精确删: 本消息沉淀的条目
      let rows = await db
        .all<{ id: number }>(`SELECT id FROM ${table} WHERE source_message_id = ?`, [sourceMessageId])
        .catch(() => [] as Array<{ id: number }>)
      // 2) 内容兜底删: 同内容条目由其他消息沉淀时, 本消息的 ✅ 也能移除整条
      if (!rows.length && hash) {
        rows = await db
          .all<{ id: number }>(`SELECT id FROM ${table} WHERE content_hash = ?`, [hash])
          .catch(() => [] as Array<{ id: number }>)
      }
      if (!rows.length) continue
      for (const r of rows) {
        await db.run(`DELETE FROM ${table} WHERE id = ?`, [r.id])
        await db.run(`DELETE FROM kb_group_members WHERE item_type = ? AND item_id = ?`, [t, r.id])
        removedIds.push({ type: t, id: Number(r.id) })
        removed++
      }
    }
    if (!removed) throw new ApiError(404, '知识库中不存在该消息对应条目')
    return ok({ removed, removed_ids: removedIds }, `已从知识库移除 (共 ${removed} 条)`)
  }),
)
