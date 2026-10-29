/** GET /api/delivery — list delivery rules joined with cards (+ payment-trigger item title). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const rows = await db.all(
      `SELECT d.id, d.keyword, d.card_id, d.delivery_count, d.delivery_times,
              d.enabled, d.require_paid, d.description, d.trigger_type, d.item_id,
              d.ship_mode,
              d.created_at, d.updated_at,
              c.name AS card_name, c.type AS card_type,
              (SELECT i.item_title FROM item_info i WHERE i.item_id = d.item_id ORDER BY i.id LIMIT 1) AS item_title
       FROM delivery_rules d
       LEFT JOIN cards c ON c.id = d.card_id
       ORDER BY d.created_at DESC`,
    )
    return ok(rows)
  }),
)
