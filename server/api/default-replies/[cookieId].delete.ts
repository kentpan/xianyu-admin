/**
 * DELETE /api/default-replies/:cookieId — 清空该账号的"已回复一次"记录 (reply_once 会重新生效)。
 * 语义对齐 butler POST /default-replies/{cid}/clear-records。
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
      throw new ApiError(403, '无权操作此账号')
    }

    const res = await db.run('DELETE FROM default_reply_records WHERE cookie_id = ?', [cookieId])
    return ok({ cookie_id: cookieId, cleared: res.changes ?? 0 }, '回复记录已清空, "只回复一次"将重新生效')
  }),
)
