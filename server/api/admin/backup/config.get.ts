/**
 * GET /api/admin/backup/config — 定时备份配置读取 (含存储模式/下次到点/回调令牌)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all<{ key_name: string; value: string }>(
      `SELECT key_name, value FROM system_settings WHERE key_name LIKE 'backup_%'`,
    )
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key_name] = r.value
    const cfg = parseBackupConfig(settings)

    // 存储模式探测 (不抛错 — 未配置时如实展示缺什么); 附带设置页 R2/S3 配置态与 CDN 域名
    let storage = ''
    let storageError = ''
    let storageSettings: { driver: string; configured: boolean; missing: string; cdn_base_url: string } = {
      driver: 'r2', configured: false, missing: '', cdn_base_url: '',
    }
    try {
      const st = await getStorageSettings(db)
      storageSettings = { driver: st.driver, configured: !!st.s3Config, missing: st.missing, cdn_base_url: st.cdnBaseUrl }
    } catch {}
    try {
      const store = await getBackupStore(event)
      storage = store.label
    } catch (e: any) {
      storageError = String(e?.message || e)
    }

    // 下次到点 (服务器时区)
    let nextDue = ''
    if (cfg.enabled) {
      const now = new Date()
      const target = new Date(now)
      target.setHours(cfg.hour, cfg.minute, cfg.second, 0)
      let due = target
      if (now.getTime() < target.getTime() || cfg.last_run_at && new Date(cfg.last_run_at).getTime() >= target.getTime()) {
        // 今天时刻未到或已跑过 → 下一个周期
        due = new Date(target.getTime() + cfg.interval_days * 86_400_000)
      }
      nextDue = due.toISOString()
    }

    return ok({ config: cfg, storage, storage_error: storageError, next_due: nextDue, storage_settings: storageSettings })
  }),
)
