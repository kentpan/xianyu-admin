/**
 * GET /api/filters — 消息过滤规则列表。
 * 过滤类型: skip_reply = 命中后不自动回复; skip_notify = 命中后不发外部通知
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const q = getQuery(event)
    const db = await getDb()

    const cookieId = (q.cookie_id || '').toString().trim()
    const rows = cookieId
      ? await db.all('SELECT * FROM message_filters WHERE cookie_id = ? ORDER BY id DESC', [cookieId])
      : await db.all('SELECT * FROM message_filters ORDER BY id DESC')

    return ok(rows)
  }),
)
