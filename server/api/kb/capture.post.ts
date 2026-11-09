/**
 * POST /api/kb/capture — 消息管理页手动添加消息到知识库 (v2.3.0)。
 * Body: { role: 'question'|'answer', content, source_message_id?, source_chat_id?, source_cookie_id?, item_id?, is_ai_generated? }
 *
 * 规则 (用户定版):
 *   - 手动添加, 无任何自动同步; 买家消息 → question, 卖家消息 → answer (前端判定 role)
 *   - 去重: content 归一化 hash 唯一 — 重复添加不新增, freq+1 (频次作置信度依据),
 *     并返回 duplicated=true 让前端 toast「已存在, 频次 +1」
 *   - 文本快照 + 溯源混合式: content 反范式化快照 (AI 检索快) + source_message_id 溯源
 *   - sort 默认排到末尾 (MAX(sort)+1), 排序即优先级
 */
import crypto from 'node:crypto'

/** 内容归一化: 去首尾空白 + 折叠连续空白 — 同文不同空白视为重复。 */
function normalizeContent(s: string): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const role = String(body?.role || '') === 'answer' ? 'answer' : 'question'
    const content = String(body?.content || '').trim()
    if (!content) throw new ApiError(400, '消息内容为空')
    if (content.length > 2000) throw new ApiError(400, '内容过长 (上限 2000 字)')

    const table = role === 'answer' ? 'kb_answers' : 'kb_questions'
    const hash = crypto.createHash('sha256').update(normalizeContent(content)).digest('hex')

    // 去重: 命中已有内容 → freq+1, 不重复添加
    const existed = await db
      .get<{ id: number; freq: number }>(`SELECT id, freq FROM ${table} WHERE content_hash = ?`, [hash])
      .catch(() => null)
    if (existed) {
      await db.run(`UPDATE ${table} SET freq = freq + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [existed.id])
      return ok({ duplicated: true, id: existed.id, freq: Number(existed.freq) + 1 }, `已存在于知识库, 未重复添加 (频次 +1 → ${Number(existed.freq) + 1})`)
    }

    const maxSort = await db.get<{ m: number }>(`SELECT COALESCE(MAX(sort), 0) m FROM ${table}`).catch(() => ({ m: 0 }))
    const sort = Number(maxSort?.m || 0) + 1
    // 两表结构不同: kb_questions 带 buyer_id (提问买家), kb_answers 带 is_ai_generated (AI 生成标记)
    const isAnswer = role === 'answer'
    const cols = isAnswer
      ? '(content, content_hash, source_message_id, source_chat_id, source_cookie_id, item_id, is_ai_generated, sort)'
      : '(content, content_hash, source_message_id, source_chat_id, source_cookie_id, item_id, buyer_id, sort)'
    const vals = isAnswer ? '?, ?, ?, ?, ?, ?, ?, ?' : '?, ?, ?, ?, ?, ?, ?, ?'
    const base = isAnswer
      ? [
          content,
          hash,
          String(body?.source_message_id || ''),
          String(body?.source_chat_id || ''),
          String(body?.source_cookie_id || ''),
          String(body?.item_id || ''),
          body?.is_ai_generated ? 1 : 0,
          sort,
        ]
      : [
          content,
          hash,
          String(body?.source_message_id || ''),
          String(body?.source_chat_id || ''),
          String(body?.source_cookie_id || ''),
          String(body?.item_id || ''),
          String(body?.buyer_id || ''),
          sort,
        ]
    const r = await db
      .run(`INSERT INTO ${table} ${cols} VALUES (${vals})`, base)
      .catch((e: any) => {
        // 并发下 hash 冲突也走去重语义
        if (String(e?.message || '').includes('UNIQUE')) return null
        throw e
      })
    if (!r) return ok({ duplicated: true }, '已存在于知识库, 未重复添加')
    return ok({ duplicated: false, id: Number(r.lastInsertId) }, '已添加到知识库')
  }),
)
