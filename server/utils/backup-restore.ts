/**
 * backup-restore — 备份导入 (v2.1.15)。
 *
 * 手动导入 (/api/admin/backup/import) 与备份列表「导入」(R2/本地快照对象回灌)
 * 共用同一套按表 PK upsert 语义, 绝不做第二套解析。
 */
import type { DatabaseAdapter } from './db'
import { isWhitelistedTable, pkOf } from './whitelist'

export type RestoreReport = Record<string, { inserted: number; updated: number; skipped: number }>

/** 导入一个 tables 对象 (按表 PK upsert; 非白名单表跳过)。 */
export async function restoreTables(db: DatabaseAdapter, incoming: Record<string, any[]>): Promise<RestoreReport> {
  if (!incoming || typeof incoming !== 'object') {
    throw new Error('备份格式错误：缺少 tables 对象')
  }
  const report: RestoreReport = {}
  await db.transaction(async () => {
    for (const [table, rows] of Object.entries(incoming)) {
      if (!isWhitelistedTable(table)) continue
      if (!Array.isArray(rows)) continue
      let inserted = 0
      let updated = 0
      let skipped = 0
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
  return report
}
