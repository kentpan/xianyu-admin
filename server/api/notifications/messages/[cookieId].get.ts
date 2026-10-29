/** GET /api/notifications/messages/:cookieId — list channels enabled for a cookie. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    if (!cookieId) throw new ApiError(400, '缺少 cookie_id')
    const db = await getDb()

    const assigned = await db.all(
      `SELECT mn.id, mn.cookie_id, mn.channel_id, mn.enabled, mn.created_at,
              ch.name AS channel_name, ch.type AS channel_type
       FROM message_notifications mn
       LEFT JOIN notification_channels ch ON ch.id = mn.channel_id
       WHERE mn.cookie_id = ?
       ORDER BY mn.created_at DESC`,
      [cookieId],
    )
    return ok(assigned)
  }),
)
