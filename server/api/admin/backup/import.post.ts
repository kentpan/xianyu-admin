/**
 * POST /api/admin/backup/import — import a JSON backup.
 *
 * Body shape: { tables: { tableName: rows[] } }
 * For each row, attempt INSERT OR REPLACE-style upsert keyed by the table's PK.
 * Falls back to plain INSERT if no PK present in the row.
 * (v2.1.15) upsert 语义抽到 server/utils/backup-restore.ts 与备份列表「导入」共用。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const body = await readBody(event) || {}
    const incoming: Record<string, any[]> = body.tables || body
    const report = await restoreTables(db, incoming)
    return ok({ report }, '备份导入完成')
  }),
)
