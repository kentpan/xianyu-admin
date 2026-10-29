/** GET /api/notifications/messages — list all message_notifications joined with cookies + channels. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT mn.id, mn.cookie_id, mn.channel_id, mn.enabled, mn.created_at,
              c.remark AS cookie_remark,
              ch.name AS channel_name, ch.type AS channel_type
       FROM message_notifications mn
       LEFT JOIN cookies c ON c.id = mn.cookie_id
       LEFT JOIN notification_channels ch ON ch.id = mn.channel_id
       ORDER BY mn.created_at DESC`,
    )
    return ok(rows)
  }),
)
