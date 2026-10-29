/**
 * GET /api/default-replies/:cookieId — 读取账号级默认回复配置 (含未回复会话记录数)。
 * 语义对齐 butler GET /default-replies/{cid}。
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    if (!cookieId) throw new ApiError(400, '无效的账号 ID')
    const db = await getDb()

    const cookie = await db.get<{ id: string; user_id: number }>('SELECT id, user_id FROM cookies WHERE id = ?', [cookieId])
    if (!cookie) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && cookie.user_id !== payload.userId) {
      throw new ApiError(403, '无权访问此账号')
    }

    const row = await db.get<any>('SELECT * FROM default_replies WHERE cookie_id = ?', [cookieId])
    const records = await db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM default_reply_records WHERE cookie_id = ?',
      [cookieId],
    ).catch(() => ({ c: 0 }))

    return ok({
      cookie_id: cookieId,
      enabled: Number(row?.enabled ?? 0),
      reply_content: String(row?.reply_content ?? ''),
      reply_image_url: String(row?.reply_image_url ?? ''),
      reply_once: Number(row?.reply_once ?? 0),
      records_count: records?.c || 0,
    })
  }),
)
