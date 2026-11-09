/**
 * PUT /api/kb/items/:type/:id — 编辑知识库条目内容 (编辑模式, v2.3.0)。
 * Body: { content } — 内容变更后重算去重 hash (改后与他条重复则 409 提示)。
 * type: 'question' → kb_questions / 'answer' → kb_answers
 */
import crypto from 'node:crypto'

function normalizeContent(s: string): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const type = getRouterParam(event, 'type') === 'answer' ? 'answer' : 'question'
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '缺少条目 ID')
    const body = await readBody(event).catch(() => ({}))
    const content = String(body?.content || '').trim()
    if (!content) throw new ApiError(400, '内容为空')
    if (content.length > 2000) throw new ApiError(400, '内容过长 (上限 2000 字)')

    const table = type === 'answer' ? 'kb_answers' : 'kb_questions'
    const hash = crypto.createHash('sha256').update(normalizeContent(content)).digest('hex')
    const dup = await db.get<{ id: number }>(`SELECT id FROM ${table} WHERE content_hash = ? AND id != ?`, [hash, id]).catch(() => null)
    if (dup) throw new ApiError(409, '知识库中已存在相同内容 (不允许重复)')

    const r = await db.run(`UPDATE ${table} SET content = ?, content_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [content, hash, id])
    if (!Number(r?.changes || 0)) throw new ApiError(404, '条目不存在')
    return ok({ id }, '已更新')
  }),
)
