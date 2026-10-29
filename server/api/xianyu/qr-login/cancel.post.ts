/** POST /api/xianyu/qr-login/cancel — cancel a pending QR login session.
 *
 * Body: `{ sessionKey }`. Marks the session cancelled in memory + DB so the
 * frontend can stop polling.
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const body = await readBody(event).catch(() => ({})) || {}
    const sessionKey = (body?.sessionKey || body?.session_key || '').toString().trim()
    if (!sessionKey) throw new ApiError(400, '缺少 sessionKey 参数')

    // Ownership check (admin bypass)
    const sessionUserId = await getSessionUserId(sessionKey)
    if (sessionUserId == null) throw new ApiError(404, '二维码会话不存在')
    if (!payload.isAdmin && sessionUserId !== payload.userId) {
      throw new ApiError(403, '无权操作此二维码会话')
    }

    await cancelQrSession(sessionKey)
    return ok({ sessionKey }, '已取消二维码登录')
  }),
)
