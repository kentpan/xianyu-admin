/** GET /api/items — list item_info, optional ?cookie_id filter. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const cookie_id = (q.cookie_id || '').toString().trim()

    const params: any[] = []
    let sql = `
      SELECT
        i.id,
        i.cookie_id,
        i.item_id,
        i.item_title,
        i.item_category,
        i.item_price,
        i.is_multi_spec,
        i.multi_quantity_delivery,
        i.created_at,
        i.updated_at,
        COALESCE(cs.enabled, 1) AS cookie_enabled,
        c.remark AS cookie_remark
      FROM item_info i
      LEFT JOIN cookies c ON c.id = i.cookie_id
      LEFT JOIN cookie_status cs ON cs.cookie_id = i.cookie_id
    `
    if (cookie_id) {
      sql += ' WHERE i.cookie_id = ?'
      params.push(cookie_id)
    }
    sql += ' ORDER BY i.updated_at DESC'

    const rows = await db.all(sql, params)
    return ok(rows)
  }),
)
