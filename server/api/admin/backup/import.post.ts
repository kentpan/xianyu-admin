/**
 * POST /api/admin/backup/import — import a JSON backup.
 *
 * Body shape: { tables: { tableName: rows[] } }
 * For each row, attempt INSERT OR REPLACE-style upsert keyed by the table's PK.
 * Falls back to plain INSERT if no PK present in the row.
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const body = await readBody(event) || {}
    const incoming: Record<string, any[]> = body.tables || body

    if (!incoming || typeof incoming !== 'object') {
      throw new ApiError(400, '备份格式错误：缺少 tables 对象')
    }

    const report: Record<string, { inserted: number; updated: number; skipped: number }> = {}

    await db.transaction(async () => {
      for (const [table, rows] of Object.entries(incoming)) {
        if (!isWhitelistedTable(table)) { continue }
        if (!Array.isArray(rows)) continue
        let inserted = 0, updated = 0, skipped = 0
        const pk = pkOf(table)

        for (const row of rows) {
          if (!row || typeof row !== 'object') { skipped++; continue }
          const cols = Object.keys(row)
          if (!cols.length) { skipped++; continue }

          // Try upsert if PK is in the row
          if (row[pk] !== undefined) {
            const existing = await db.get(`SELECT ${pk} FROM ${table} WHERE ${pk} = ?`, [row[pk]])
            if (existing) {
              const setClause = cols.filter((c) => c !== pk).map((c) => `${c} = ?`).join(', ')
              const setVals = cols.filter((c) => c !== pk).map((c) => row[c])
              if (setClause) {
                await db.run(`UPDATE ${table} SET ${setClause} WHERE ${pk} = ?`, [...setVals, row[pk]])
                updated++
              } else { skipped++ }
              continue
            }
          }

          // Otherwise insert
          const placeholders = cols.map(() => '?').join(', ')
          const vals = cols.map((c) => row[c])
          try {
            await db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, vals)
            inserted++
          } catch {
            skipped++
          }
        }
        report[table] = { inserted, updated, skipped }
      }
    })

    return ok({ report }, '备份导入完成')
  }),
)
