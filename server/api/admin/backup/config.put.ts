/**
 * PUT /api/admin/backup/config — 定时备份配置更新。
 * Body: { enabled, interval_days, hour, minute, second, tables, generate_cron_token? }
 * generate_cron_token=true 时生成新的回调令牌 (供 Cloudflare Cron / 外部定时器回调)。
 */
const BACKUP_SETTING_KEYS = [
  'backup_enabled', 'backup_interval_days', 'backup_hour', 'backup_minute',
  'backup_second', 'backup_tables', 'backup_cron_token',
] as const

export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const clamp = (v: any, def: number, min: number, max: number) => {
      const n = parseInt(String(v ?? ''), 10)
      return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
    }
    const updates: Array<[string, string]> = []
    if (body.enabled !== undefined) updates.push(['backup_enabled', body.enabled ? 'true' : 'false'])
    if (body.interval_days !== undefined) updates.push(['backup_interval_days', String(clamp(body.interval_days, 1, 1, 3650))])
    if (body.hour !== undefined) updates.push(['backup_hour', String(clamp(body.hour, 4, 0, 23))])
    if (body.minute !== undefined) updates.push(['backup_minute', String(clamp(body.minute, 38, 0, 59))])
    if (body.second !== undefined) updates.push(['backup_second', String(clamp(body.second, 0, 0, 59))])
    if (body.tables !== undefined) {
      const t = String(body.tables).trim() || 'all'
      if (t !== 'all') {
        const names = t.split(',').map((s) => s.trim()).filter(Boolean)
        for (const n of names) {
          if (!isWhitelistedTable(n)) throw new ApiError(400, `表不在白名单内: ${n}`)
        }
        if (!names.length) throw new ApiError(400, '表范围不能为空')
      }
      updates.push(['backup_tables', t])
    }
    if (body.generate_cron_token) {
      const token = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 10)).join('')
      updates.push(['backup_cron_token', token])
    }
    if (!updates.length) throw new ApiError(400, '没有需要更新的配置')

    for (const [key, value] of updates) {
      await db
        .run(
          'UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key_name = ?',
          [value, key],
        )
        .catch(async () => {
          await db.run(
            'INSERT INTO system_settings (key_name, value, description) VALUES (?, ?, ?)',
            [key, value, '备份管理配置'],
          ).catch(() => {})
        })
    }

    const rows = await db.all<{ key_name: string; value: string }>(
      `SELECT key_name, value FROM system_settings WHERE key_name IN (${BACKUP_SETTING_KEYS.map(() => '?').join(',')})`,
      [...BACKUP_SETTING_KEYS],
    )
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key_name] = r.value
    return ok({ config: parseBackupConfig(settings) }, '备份配置已保存')
  }),
)
