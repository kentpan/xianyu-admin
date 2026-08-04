/** GET /api/dashboard/health — system health (uptime, memory, DB size, table counts). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const state = getRuntimeState()

    // Process metrics
    const mem = process.memoryUsage()
    const uptime = Math.floor(process.uptime())

    // DB stats
    let dbSize = 0
    let tableCount = 0
    let totalRows = 0

    if (state.dbDriver === 'sqlite') {
      try {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const dbPath = (state.dbUrl || 'data/xianyu_admin.db').replace(/^file:/, '')
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
        if (state.dbDriver === 'mysql') {
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

    // CPU load (approximate via process)
    const cpuUsage = process.cpuUsage()

    return ok({
      uptime,
      uptimeLabel: formatUptime(uptime),
      memory: {
        rss: mem.rss,
        rssLabel: formatBytes(mem.rss),
        heapUsed: mem.heapUsed,
        heapUsedLabel: formatBytes(mem.heapUsed),
        heapTotal: mem.heapTotal,
        heapTotalLabel: formatBytes(mem.heapTotal),
        heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
      },
      db: {
        driver: state.dbDriver,
        size: dbSize,
        sizeLabel: formatBytes(dbSize),
        tableCount,
        totalRows,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      nodeVersion: process.version,
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
