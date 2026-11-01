/**
 * POST /api/admin/backup/cron — 定时备份回调 (Cloudflare Cron Triggers / 外部定时器调用)。
 *
 * 鉴权: header x-backup-token 或 query token 必须等于 system_settings.backup_cron_token
 * (备份页可生成令牌; 令牌为空 = 回调通道未启用, 一律拒绝)。
 *
 * 到点判定: enabled 且 isBackupDue (每 X 天 X时X分X秒, 见 backup-runner.ts) 才真正执行;
 * 未到点/未启用如实返回 skipped, 绝不重复备份。
 */
export default defineEventHandler(
  withApi(async (event) => {
    // 令牌校验 (非空常量比对; 回调方为定时器而非用户会话, 不走 requireAdmin)
    const db = await getDb()
    const q = getQuery(event)
    const token = String(getHeader(event, 'x-backup-token') || q.token || '')
    const rows = await db.all<{ key_name: string; value: string }>(
      `SELECT key_name, value FROM system_settings WHERE key_name LIKE 'backup_%'`,
    )
    const cfg = parseBackupConfig(Object.fromEntries(rows.map((r) => [r.key_name, r.value])))
    if (!cfg.cron_token) throw new ApiError(403, '备份回调未启用: 请先在备份管理页生成回调令牌')
    if (token !== cfg.cron_token) throw new ApiError(403, '备份回调令牌无效')

    const due = isBackupDue(cfg)
    if (!due.due) {
      return ok({ skipped: true, reason: due.reason })
    }

    const store = await getBackupStore(event)
    const result = await runBackup(db, store, cfg.tables)
    await markBackupRan(db)
    return ok(
      { backup: result },
      `定时备份完成: ${result.key} (${result.tables.length} 表 / ${result.rows} 行 → ${result.storage})`,
    )
  }),
)
