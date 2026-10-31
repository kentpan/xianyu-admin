/** GET /api/xianyu/qr-login/status?sessionKey=... — poll QR scan status.
 *
 * 纯内存读取 (服务端后台监控驱动状态机), status 响应毫秒级。
 * On `success`, persist the account into the `cookies` table; the builtin
 * engine (engine-manager 5s poll) picks it up automatically → 监听自动拉起。
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const q = getQuery(event) as any
    const sessionKey = (q.sessionKey || q.session_key || '').toString().trim()
    if (!sessionKey) throw new ApiError(400, '缺少 sessionKey 参数')

    // Verify ownership: the session's userId must match the caller (admin bypass)
    const sessionUserId = await getSessionUserId(sessionKey)
    if (sessionUserId == null) throw new ApiError(404, '二维码会话不存在')
    if (!payload.isAdmin && sessionUserId !== payload.userId) {
      throw new ApiError(403, '无权访问此二维码会话')
    }

    const result = await getSessionStatus(sessionKey)

    if (result.status === 'success' && result.cookieValue && result.xianyuUid) {
      const db = await getDb()
      const cookieId = `xy_${result.xianyuUid}`
      const remark = result.xianyuNick || result.xianyuUid
      // INSERT OR IGNORE — if the same xianyu_uid already exists for this
      // user, update the value instead of creating a duplicate.
      await db.run(
        `INSERT INTO cookies (
          id, value, user_id, auto_confirm, remark, pause_duration,
          username, password, show_browser,
          login_type, xianyu_uid, avatar, cookie_status_text
        ) VALUES (?, ?, ?, 1, ?, 10, '', '', 0, 'qrcode', ?, '', 'valid')
        ON CONFLICT(id) DO UPDATE SET
          value = excluded.value,
          remark = COALESCE(NULLIF(excluded.remark, ''), cookies.remark),
          cookie_status_text = 'valid',
          last_check_at = CURRENT_TIMESTAMP`,
        [cookieId, result.cookieValue, sessionUserId, remark, result.xianyuUid],
      )
      // Ensure cookie_status enabled row exists
      await db.run(
        `INSERT INTO cookie_status (cookie_id, enabled, updated_at) VALUES (?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(cookie_id) DO UPDATE SET enabled = 1, updated_at = CURRENT_TIMESTAMP`,
        [cookieId],
      )
      await auditLog(event, {
        action: 'create',
        module: 'accounts',
        targetType: 'cookie',
        targetId: cookieId,
        desc: `扫码登录账号 ${remark} (uid=${result.xianyuUid})`,
      })
    }

    return ok(result)
  }),
)
