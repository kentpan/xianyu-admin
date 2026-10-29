/** GET /api/messages/list — 某会话消息分页 (?cookie_id&chat_id&before_id&limit)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const cookieId = (q.cookie_id || '').toString().trim()
    const chatId = (q.chat_id || '').toString().trim()
    if (!cookieId || !chatId) throw new ApiError(400, '缺少 cookie_id 或 chat_id')

    const limit = Math.min(200, Math.max(1, Number(q.limit || 50)))
    const beforeId = Number(q.before_id || 0)

    const params: any[] = [cookieId, chatId]
    let beforeSql = ''
    if (beforeId > 0) {
      beforeSql = ' AND id < ?'
      params.push(beforeId)
    }
    const rows = await db.all(
      `SELECT id, direction, sender_user_id, sender_nick, content, content_type, item_id, order_id, amount, status_text, msg_time
       FROM im_messages
       WHERE cookie_id = ? AND chat_id = ?${beforeSql}
       ORDER BY id DESC
       LIMIT ?`,
      [...params, limit],
    )
    rows.reverse()
    return ok(rows)
  }),
)
