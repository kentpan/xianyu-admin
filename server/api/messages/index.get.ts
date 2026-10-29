/** GET /api/messages — IM 会话列表 (im_conversations, 可按账号/关键词过滤)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const cookie_id = (q.cookie_id || '').toString().trim()
    const keyword = (q.keyword || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (cookie_id) {
      where.push('cv.cookie_id = ?')
      params.push(cookie_id)
    }
    if (keyword) {
      where.push('(cv.chat_id LIKE ? OR cv.peer_nick LIKE ? OR cv.last_message LIKE ? OR cv.item_id LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const rows = await db.all(
      `SELECT cv.*, c.remark AS cookie_remark, ii.item_title
       FROM im_conversations cv
       LEFT JOIN cookies c ON c.id = cv.cookie_id
       LEFT JOIN item_info ii ON ii.cookie_id = cv.cookie_id AND ii.item_id = cv.item_id
       ${whereSql}
       ORDER BY cv.last_message_time DESC, cv.updated_at DESC
       LIMIT 200`,
      params,
    )
    return ok(rows)
  }),
)
