/** GET /api/dashboard/health — system health (uptime, memory, DB size, table counts).
 *
 * Runtime-safe by design: on Cloudflare Pages (workerd + unenv polyfill layer)
 * `process.memoryUsage/cpuUsage/uptime` are not-implemented stubs that THROW on
 * call — this endpoint must degrade to zeroed metrics, never 500.
 */
import { databaseFilePath } from '../../utils/db-config'

/** Current isolate boot time — uptime source that works on every runtime. */
const BOOT_AT = Date.now()

/** Call a Node-only metric, fall back silently when the runtime lacks it. */
function tryMetric<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn()
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const state = getRuntimeState()

    // Process metrics — all guarded (workerd has no process.memoryUsage/cpuUsage)
    const mem = tryMetric(() => process.memoryUsage(), null as any)
    const uptime = tryMetric(
      () => Math.floor(process.uptime()),
      Math.floor((Date.now() - BOOT_AT) / 1000),
    )
    const cpuUsage = tryMetric(() => process.cpuUsage(), { user: 0, system: 0 })
    const nodeVersion = tryMetric(() => process.version, 'workerd')

    // DB stats — branch on the ADAPTER's real driver (on Cloudflare the sqlite
    // config auto-adapts to D1, state.dbDriver alone would misroute the branch)
    const driver = db.driver || state.dbDriver
    let dbSize = 0
    let tableCount = 0
    let totalRows = 0

    if (driver === 'sqlite') {
      try {
        const fs = await import('node:fs')
        const dbPath = databaseFilePath()
        if (fs.existsSync(dbPath)) {
          dbSize = fs.statSync(dbPath).size
        }
      } catch (e) {
        console.log('[health] db file stat error:', e)
      }
      const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").catch((e: any) => {
        console.log('[health] sqlite tables query error:', e)
        return []
      })
      tableCount = tables.length
      for (const t of tables) {
        const r = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM "${t.name}"`).catch((e: any) => {
          console.log('[health] table count query error:', e)
          return null
        })
        if (r) totalRows += r.c
      }
    } else {
      // 非 sqlite 驱动（MySQL/D1/memory）：查询真实表数量，失败时保持 0
      try {
        if (driver === 'mysql') {
          const r = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = DATABASE()')
          tableCount = r?.c || 0
        } else {
          // D1/memory 基于 SQLite 引擎，可用 sqlite_master
          const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          tableCount = tables.length
        }
      } catch (e) {
        console.log('[health] table count query error:', e)
      }
    }

    return ok({
      uptime,
      uptimeLabel: formatUptime(uptime),
      memory: {
        rss: mem?.rss ?? 0,
        rssLabel: mem ? formatBytes(mem.rss) : '—',
        heapUsed: mem?.heapUsed ?? 0,
        heapUsedLabel: mem ? formatBytes(mem.heapUsed) : '—',
        heapTotal: mem?.heapTotal ?? 0,
        heapTotalLabel: mem ? formatBytes(mem.heapTotal) : '—',
        heapPercent: mem && mem.heapTotal ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0,
      },
      db: {
        driver,
        size: dbSize,
        sizeLabel: formatBytes(dbSize),
        tableCount,
        totalRows,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      nodeVersion,
      timestamp: new Date().toISOString(),
    })
  }),
)

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${units[i]}`
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}天${h}小时`
  if (h > 0) return `${h}小时${m}分`
  return `${m}分钟`
}
