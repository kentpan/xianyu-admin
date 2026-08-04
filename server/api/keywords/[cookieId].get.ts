/** GET /api/keywords/:cookieId — list keywords for a cookie. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const db = await getDb()

    const rows = await db.all(
      `SELECT k.*, ii.item_title
       FROM keywords k
       LEFT JOIN item_info ii ON ii.cookie_id = k.cookie_id AND ii.item_id = k.item_id
       WHERE k.cookie_id = ?
       ORDER BY k.created_at DESC`,
      [cookieId],
    )

    return ok(rows)
  }),
)
