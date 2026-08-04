/** GET /api/settings — admin-only: list all system_settings. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all('SELECT key_name, value, description, updated_at FROM system_settings ORDER BY key_name')
    return ok(rows)
  }),
)
