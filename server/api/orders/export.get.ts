/** GET /api/orders/export — return all orders as JSON for download. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const rows = await db.all(
      `SELECT o.*, ii.item_title
       FROM orders o
       LEFT JOIN item_info ii ON ii.cookie_id = o.cookie_id AND ii.item_id = o.item_id
       ORDER BY o.created_at DESC`,
    )

    return ok({ orders: rows, exported_at: new Date().toISOString(), count: rows.length }, '导出成功')
  }),
)
