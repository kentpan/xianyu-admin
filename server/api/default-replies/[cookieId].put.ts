/**
 * PUT /api/default-replies/:cookieId — 保存账号级默认回复 (upsert)。
 * Body: { enabled: 0|1, reply_content?: string, reply_image_url?: string, reply_once?: 0|1 }
 * 语义对齐 butler PUT /default-replies/{cid}。
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    if (!cookieId) throw new ApiError(400, '无效的账号 ID')
    const body = await readBody(event)
    const db = await getDb()

    const cookie = await db.get<{ id: string; user_id: number }>('SELECT id, user_id FROM cookies WHERE id = ?', [cookieId])
    if (!cookie) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && cookie.user_id !== payload.userId) {
      throw new ApiError(403, '无权操作此账号')
    }

    const enabled = body?.enabled ? 1 : 0
    const replyContent = String(body?.reply_content ?? '').trim()
    const replyImageUrl = String(body?.reply_image_url ?? '').trim()
    const replyOnce = body?.reply_once ? 1 : 0

    if (enabled && !replyContent && !replyImageUrl) {
      throw new ApiError(400, '启用默认回复时必须填写回复文本或图片 URL')
    }

    await db.run(
      `INSERT INTO default_replies (cookie_id, enabled, reply_content, reply_image_url, reply_once)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (cookie_id) DO UPDATE SET
         enabled = excluded.enabled,
         reply_content = excluded.reply_content,
         reply_image_url = excluded.reply_image_url,
         reply_once = excluded.reply_once,
         updated_at = CURRENT_TIMESTAMP`,
      [cookieId, enabled, replyContent, replyImageUrl, replyOnce],
    )

    await auditLog(event, {
      action: 'update',
      module: 'default-replies',
      targetType: 'account',
      targetId: cookieId,
      desc: `保存账号默认回复 (enabled=${enabled}, once=${replyOnce})`,
    })

    return ok({ cookie_id: cookieId, enabled, reply_content: replyContent, reply_image_url: replyImageUrl, reply_once: replyOnce }, '默认回复已保存')
  }),
)
