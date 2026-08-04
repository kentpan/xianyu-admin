/** GET /api/accounts — list all cookies joined with cookie_status + keyword count. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const rows = await db.all(`
      SELECT
        c.id,
        SUBSTR(c.value, 1, 24) AS value_preview,
        c.auto_confirm,
        c.remark,
        c.pause_duration,
        c.username,
        c.created_at,
        COALESCE(cs.enabled, 1) AS enabled,
        (SELECT COUNT(*) FROM keywords k WHERE k.cookie_id = c.id) AS keyword_count
      FROM cookies c
      LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
      ORDER BY c.created_at DESC
    `)

    return ok(rows)
  }),
)
