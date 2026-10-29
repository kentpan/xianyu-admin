/** GET /api/xianyu/qr-login/sessions — list recent QR login sessions.
 *
 * Regular users see only their own; admins see all. `cookie_value` is
 * deliberately excluded for security (it's a credential).
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    let rows: any[]
    if (payload.isAdmin) {
      rows = await db.all(
        `SELECT
          s.session_key, s.user_id, s.status, s.qr_url,
          s.xianyu_uid, s.xianyu_nick, s.error_message,
          s.created_at, s.updated_at,
          u.username AS owner_username
        FROM qr_login_sessions s
        LEFT JOIN users u ON u.id = s.user_id
        ORDER BY s.created_at DESC
        LIMIT 50`,
      )
    } else {
      rows = await db.all(
        `SELECT
          session_key, user_id, status, qr_url,
          xianyu_uid, xianyu_nick, error_message,
          created_at, updated_at
        FROM qr_login_sessions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 20`,
        [payload.userId],
      )
    }

    return ok(rows)
  }),
)
