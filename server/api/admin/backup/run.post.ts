/**
 * POST /api/admin/backup/run — 手动执行一次定时备份链路 (管理员触发, 与定时回调同一实现)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const store = await getBackupStore(event)
    const rows = await db.all<{ key_name: string; value: string }>(
      `SELECT key_name, value FROM system_settings WHERE key_name LIKE 'backup_%'`,
    )
    const cfg = parseBackupConfig(Object.fromEntries(rows.map((r) => [r.key_name, r.value])))
    const result = await runBackup(db, store, cfg.tables)
    await markBackupRan(db)
    return ok(
      { backup: result },
      `备份完成: ${result.key} (${result.tables.length} 表 / ${result.rows} 行 → ${result.storage})`,
    )
  }),
)
