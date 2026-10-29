/**
 * GET /api/auto-reply-logs — 回复决策日志列表 (监听引擎写入)。
 *
 * 查询参数: cookie_id 可选, keyword 可选(模糊匹配来源消息/命中关键词/回复内容),
 *          limit 默认 100, offset 默认 0
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const q = getQuery(event)
    const db = await getDb()

    const cookieId = (q.cookie_id || '').toString().trim()
    const keyword = (q.keyword || '').toString().trim()
    const strategy = (q.strategy || '').toString().trim()
    const limit = Math.min(Math.max(parseInt(q.limit as string, 10) || 100, 1), 500)
    const offset = Math.max(parseInt(q.offset as string, 10) || 0, 0)

    const conds: string[] = []
    const params: any[] = []
    if (cookieId) {
      conds.push('cookie_id = ?')
      params.push(cookieId)
    }
    if (keyword) {
      conds.push('(source_message LIKE ? OR matched_keyword LIKE ? OR reply_text LIKE ? OR sender_user_name LIKE ?)')
      const like = `%${keyword}%`
      params.push(like, like, like, like)
    }
    if (strategy) {
      conds.push('reply_strategy = ?')
      params.push(strategy)
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const rows = await db.all<any>(
      `SELECT * FROM auto_reply_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    const totalRow = await db.get<any>(
      `SELECT COUNT(*) AS total FROM auto_reply_logs ${where}`,
      params,
    )

    return ok({ logs: rows, total: totalRow?.total || 0, limit, offset })
  }),
)
