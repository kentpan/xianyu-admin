/**
 * POST /api/kb/sort — 调整问话/回答排序 (浏览模式 hover 上移/下移箭头, v2.3.0)。
 * Body: { type: 'question'|'answer', id, direction: 'up'|'down' }
 *
 * sort 即优先级 (升序, 越小越优先): 与相邻条目交换 sort 值, AI 检索按此顺序
 * 取上下文, 排序在前的问答优先被引用。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const type = String(body?.type) === 'answer' ? 'answer' : 'question'
    const id = Number(body?.id)
    const direction = String(body?.direction) === 'down' ? 'down' : 'up'
    if (!id) throw new ApiError(400, '缺少条目 ID')
    const table = type === 'answer' ? 'kb_answers' : 'kb_questions'

    const cur = await db.get<{ id: number; sort: number }>(`SELECT id, sort FROM ${table} WHERE id = ?`, [id])
    if (!cur) throw new ApiError(404, '条目不存在')
    // 相邻条目: up = sort 比当前小的最大者; down = sort 比当前大的最小者 (再按 id 稳定序)
    const neighbor =
      direction === 'up'
        ? await db.get<{ id: number; sort: number }>(`SELECT id, sort FROM ${table} WHERE sort < ? OR (sort = ? AND id < ?) ORDER BY sort DESC, id DESC LIMIT 1`, [
            cur.sort,
            cur.sort,
            cur.id,
          ])
        : await db.get<{ id: number; sort: number }>(`SELECT id, sort FROM ${table} WHERE sort > ? OR (sort = ? AND id > ?) ORDER BY sort ASC, id ASC LIMIT 1`, [
            cur.sort,
            cur.sort,
            cur.id,
          ])
    if (!neighbor) return ok({ moved: false }, direction === 'up' ? '已在最前' : '已在最后')
    await db.run('UPDATE ' + table + ' SET sort = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [neighbor.sort, cur.id])
    await db.run('UPDATE ' + table + ' SET sort = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cur.sort, neighbor.id])
    return ok({ moved: true }, '排序已更新 (排序即优先级)')
  }),
)
