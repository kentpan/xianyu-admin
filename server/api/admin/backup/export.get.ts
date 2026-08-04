/**
 * GET /api/admin/backup/export — export all whitelisted tables as a JSON download.
 *
 * NOTE: does NOT use withApi/ok because we want the client to receive the
 * raw JSON object (with download headers), not wrapped in our envelope.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = await getDb()

  const tables: Record<string, any[]> = {}
  for (const name of DATA_TABLE_WHITELIST) {
    try {
      tables[name] = await db.all(`SELECT * FROM ${name}`)
    } catch {
      tables[name] = []
    }
  }

  const payload = {
    exported_at: new Date().toISOString(),
    driver: db.driver,
    tables,
  }

  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="xianyu-admin-backup-${Date.now()}.json"`)
  return payload
})
