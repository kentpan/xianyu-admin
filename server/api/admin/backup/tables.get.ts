/**
 * GET /api/admin/backup/tables — 可备份表清单 (白名单 + 行数), 备份页多选导出消费。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const tables = []
    for (const name of DATA_TABLE_WHITELIST) {
      let rows = 0
      try {
        const r = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${name}`)
        rows = Number(r?.c || 0)
      } catch {
        rows = 0
      }
      tables.push({ name, rows })
    }
    return ok({ tables, driver: db.driver })
  }),
)
