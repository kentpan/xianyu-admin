/** GET /api/item-replies — list item_replay joined with item_info for title. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const cookieId = (q.cookie_id || '').toString().trim()

    const params: any[] = []
    let sql = `
      SELECT
        r.id, r.item_id, r.cookie_id, r.reply_content, r.created_at, r.updated_at,
        ii.item_title, ii.item_price, ii.item_category,
        c.remark AS cookie_remark,
        ias.ai_enabled, ias.ai_config_id, ac.name AS ai_config_name
      FROM item_replay r
      LEFT JOIN item_info ii ON ii.cookie_id = r.cookie_id AND ii.item_id = r.item_id
      LEFT JOIN cookies c ON c.id = r.cookie_id
      LEFT JOIN item_ai_settings ias ON ias.cookie_id = r.cookie_id AND ias.item_id = r.item_id
      LEFT JOIN ai_configs ac ON ac.id = ias.ai_config_id
    `
    if (cookieId) {
      sql += ' WHERE r.cookie_id = ?'
      params.push(cookieId)
    }
    sql += ' ORDER BY r.updated_at DESC'

    const rows = await db.all(sql, params)
    return ok(rows)
  }),
)
