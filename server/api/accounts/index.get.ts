/** GET /api/accounts — list cookies joined with cookie_status + keyword count.
 *
 * Visibility:
 *   - admin users see ALL cookies (legacy behaviour)
 *   - regular users see only their own cookies (filtered by user_id)
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()

    const params: any[] = []
    let where = ''
    if (!payload.isAdmin) {
      where = 'WHERE c.user_id = ?'
      params.push(payload.userId)
    }

    const rows = await db.all(
      `SELECT
        c.id,
        SUBSTR(c.value, 1, 24) AS value_preview,
        c.user_id,
        c.auto_confirm,
        c.remark,
        c.pause_duration,
        c.username,
        c.created_at,
        c.login_type,
        c.xianyu_uid,
        c.avatar,
        c.cookie_status_text,
        c.last_check_at,
        COALESCE(cs.enabled, 1) AS enabled,
        (SELECT COUNT(*) FROM keywords k WHERE k.cookie_id = c.id) AS keyword_count
      FROM cookies c
      LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
      ${where}
      ORDER BY c.created_at DESC`,
      params,
    )

    return ok(rows)
  }),
)
