/**
 * backup-runner — 备份执行器 (v2.1.15)。
 *
 * 快照格式: JSON envelope { exported_at, driver, tables: { 表名: 行[] } }
 *   — 与 /api/admin/backup/import.post.ts 的导入格式完全同源, 备份列表「导入」
 *   即复用该导入链路 (按表 PK upsert), 绝不做第二套解析。
 *
 * 定时语义「每 X 天 X时X分X秒」:
 *   - 到点判定: 今天的服务器时区 H:M:S 时刻已过 && 上次运行早于该时刻 &&
 *     今天距上次运行日 >= X 天 (首次运行 last 为空 → 到点即跑);
 *   - Cloudflare Cron Triggers 最小粒度是分钟, 秒级由「分钟内到点判定」兑现
 *     (cron 每分钟打一次 /api/admin/backup/cron, 在 H:M:S 落入的那个分钟窗口内执行)。
 */
import type { DatabaseAdapter } from './db'
import { DATA_TABLE_WHITELIST, isWhitelistedTable } from './whitelist'

export interface BackupConfig {
  enabled: boolean
  interval_days: number
  hour: number
  minute: number
  second: number
  tables: string
  last_run_at: string
  cron_token: string
}

export function parseBackupConfig(settings: Record<string, string>): BackupConfig {
  const num = (v: string | undefined, def: number, min: number, max: number) => {
    const n = parseInt(String(v ?? ''), 10)
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
  }
  return {
    enabled: String(settings.backup_enabled ?? 'false') === 'true',
    interval_days: num(settings.backup_interval_days, 1, 1, 3650),
    hour: num(settings.backup_hour, 4, 0, 23),
    minute: num(settings.backup_minute, 38, 0, 59),
    second: num(settings.backup_second, 0, 0, 59),
    tables: String(settings.backup_tables ?? 'all') || 'all',
    last_run_at: String(settings.backup_last_run_at ?? ''),
    cron_token: String(settings.backup_cron_token ?? ''),
  }
}

/** 解析定时备份的表范围: 'all' → 全部白名单表; 否则按逗号分隔且仅保留白名单内表名。 */
export function resolveBackupTables(tables: string): string[] {
  const t = String(tables || 'all').trim()
  if (!t || t === 'all') return [...DATA_TABLE_WHITELIST]
  return t
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && isWhitelistedTable(s))
}

/** 收集快照数据 (JSON envelope)。 */
export async function collectSnapshot(db: DatabaseAdapter, tablesParam: string | string[]): Promise<{
  exported_at: string
  driver: string
  tables: Record<string, any[]>
}> {
  const wanted = Array.isArray(tablesParam) ? tablesParam : resolveBackupTables(tablesParam)
  const tables: Record<string, any[]> = {}
  for (const name of wanted) {
    if (!isWhitelistedTable(name)) continue
    try {
      tables[name] = await db.all(`SELECT * FROM ${name}`)
    } catch {
      tables[name] = []
    }
  }
  return { exported_at: new Date().toISOString(), driver: db.driver, tables }
}

/** 到点判定结果 (due + 如实原因, 供回调端点原样透出)。 */
export function isBackupDue(cfg: BackupConfig, now = new Date()): { due: boolean; reason: string } {
  if (!cfg.enabled) return { due: false, reason: '定时备份未启用' }
  const target = new Date(now)
  target.setHours(cfg.hour, cfg.minute, cfg.second, 0)
  if (now.getTime() < target.getTime()) return { due: false, reason: `未到今天的备份时刻 (${cfg.hour}:${cfg.minute}:${cfg.second})` } // 今天的目标时刻未到
  if (!cfg.last_run_at) return { due: true, reason: '首次备份: 已到点且从未运行' } // 首次: 到点即跑
  const last = new Date(cfg.last_run_at)
  if (Number.isNaN(last.getTime())) return { due: true, reason: '上次运行时间损坏, 视作从未运行' } // 上次时间损坏 → 视作从未跑过
  if (last.getTime() >= target.getTime()) return { due: false, reason: '今天的备份时刻已运行过' } // 今天的时刻已跑过
  const lastTarget = new Date(last)
  lastTarget.setHours(cfg.hour, cfg.minute, cfg.second, 0)
  const dayDiff = Math.floor((target.getTime() - lastTarget.getTime()) / 86_400_000)
  if (dayDiff < cfg.interval_days) {
    return { due: false, reason: `未到周期: 距上次运行 ${dayDiff} 天, 需 ≥ ${cfg.interval_days} 天` }
  }
  return { due: true, reason: `已到点 (每 ${cfg.interval_days} 天 ${cfg.hour}:${cfg.minute}:${cfg.second})` }
}

export interface BackupRunResult {
  key: string
  size: number
  storage: string
  tables: string[]
  rows: number
  skipped?: string
}

/** 执行一次备份并落存储 (定时/手动共用)。 */
export async function runBackup(
  db: DatabaseAdapter,
  store: Awaited<ReturnType<typeof getBackupStore>>,
  tablesParam: string | string[],
): Promise<BackupRunResult> {
  const snapshot = await collectSnapshot(db, tablesParam)
  const tableNames = Object.keys(snapshot.tables)
  const json = JSON.stringify(snapshot)
  const d = new Date()
  const pad = (n: number, l = 2) => String(n).padStart(l, '0')
  const key = `backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`
  await store.put(key, json)
  const rows = tableNames.reduce((acc, t) => acc + (snapshot.tables[t]?.length || 0), 0)
  return { key, size: new TextEncoder().encode(json).length, storage: store.label, tables: tableNames, rows }
}

/** 备份后回写 last_run 设置。 */
export async function markBackupRan(db: DatabaseAdapter): Promise<void> {
  await db
    .run(
      "UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key_name = 'backup_last_run_at'",
      [new Date().toISOString()],
    )
    .catch(() => {})
}
