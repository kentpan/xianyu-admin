/** GET /api/notifications/channels — list notification channels. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT id, name, type, config, enabled, created_at, updated_at
       FROM notification_channels
       ORDER BY created_at DESC`,
    )
    return ok(rows)
  }),
)
