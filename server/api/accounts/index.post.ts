/** POST /api/accounts — create a new cookie (and seed cookie_status enabled=1).
 *
 * Per-user ownership: the cookie is bound to the authenticated user's id.
 * Body fields:
 *   - value (required)            : cookie string
 *   - id (optional)               : custom cookie id; auto-generated if absent
 *   - remark (optional)           : friendly label
 *   - pause_duration (optional)   : minutes (人工回复后暂停自动回复的时长, 0=不暂停); default 10
 *   - auto_confirm (optional)     : 1/0; default 1
 *   - login_type (optional)       : 'cookie' (default) | 'qrcode'
 *   - xianyu_uid (optional)       : xianyu numeric user id (unb)
 *   - avatar (optional)           : account avatar URL
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const body = await readBody(event)
    const id = (body?.id || '').trim() || (crypto.randomUUID?.() || randomId())
    const value = (body?.value || '').toString().trim()
    const remark = (body?.remark || '').toString().trim()
    const pause_duration = Number(body?.pause_duration ?? 10)
    const auto_confirm = body?.auto_confirm === false || body?.auto_confirm === 0 ? 0 : 1
    const login_type = (body?.login_type || 'cookie').toString().slice(0, 16)
    const xianyu_uid = (body?.xianyu_uid || '').toString().trim()
    const avatar = (body?.avatar || '').toString().trim()

    if (!value) throw new ApiError(400, 'Cookie 内容不能为空')

    const existing = await db.get('SELECT id FROM cookies WHERE id = ?', [id])
    if (existing) throw new ApiError(409, '账号 ID 已存在')

    await db.run(
      `INSERT INTO cookies (
        id, value, user_id, auto_confirm, remark, pause_duration,
        username, password, show_browser,
        login_type, xianyu_uid, avatar, cookie_status_text
      ) VALUES (?, ?, ?, ?, ?, ?, '', '', 0, ?, ?, ?, 'unknown')`,
      [id, value, payload.userId, auto_confirm, remark, pause_duration, login_type, xianyu_uid, avatar],
    )
    await db.run(
      `INSERT INTO cookie_status (cookie_id, enabled, updated_at) VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(cookie_id) DO UPDATE SET enabled = 1, updated_at = CURRENT_TIMESTAMP`,
      [id],
    )

    await auditLog(event, { action: 'create', module: 'accounts', targetType: 'cookie', targetId: id, desc: `新增账号 ${remark || id}` })
    return ok({ id }, '账号已添加')
  }),
)

function randomId(): string {
  return 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
