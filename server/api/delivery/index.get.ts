/** GET /api/delivery — list delivery rules joined with cards. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT d.id, d.keyword, d.card_id, d.delivery_count, d.delivery_times,
              d.enabled, d.description, d.created_at, d.updated_at,
              c.name AS card_name, c.type AS card_type
       FROM delivery_rules d
       LEFT JOIN cards c ON c.id = d.card_id
       ORDER BY d.created_at DESC`,
    )
    return ok(rows)
  }),
)
