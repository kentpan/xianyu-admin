/** GET /api/admin/data — list whitelisted tables + row counts. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()

    const tables: { name: string; rows: number }[] = []
    for (const name of DATA_TABLE_WHITELIST) {
      try {
        const r = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${name}`)
        tables.push({ name, rows: r?.c ?? 0 })
      } catch {
        tables.push({ name, rows: 0 })
      }
    }
    const total = tables.reduce((a, b) => a + b.rows, 0)
    return ok({ tables, total })
  }),
)
