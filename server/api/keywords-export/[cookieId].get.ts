/** GET /api/keywords-export/:cookieId — export keywords as JSON. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const db = await getDb()

    const rows = await db.all(
      'SELECT * FROM keywords WHERE cookie_id = ? ORDER BY created_at DESC',
      [cookieId],
    )

    return ok({ keywords: rows, count: rows.length, exported_at: new Date().toISOString() }, '导出成功')
  }),
)
