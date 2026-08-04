/** GET /api/about/stats — public project metrics for the about page. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const counts = await Promise.all([
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM users'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cookies'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM orders'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM item_info'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM keywords'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM cards'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM delivery_rules'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM notification_channels'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM system_settings'),
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM system_logs'),
    ])

    let tableCount = 0
    const state = getRuntimeState()
    if (state.dbDriver === 'sqlite' || state.dbDriver === 'memory') {
      const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").catch(() => [])
      tableCount = rows.length
    } else {
      tableCount = 18
    }

    const config = useRuntimeConfig()
    return ok({
      users: counts[0]?.c || 0,
      accounts: counts[1]?.c || 0,
      orders: counts[2]?.c || 0,
      items: counts[3]?.c || 0,
      keywords: counts[4]?.c || 0,
      cards: counts[5]?.c || 0,
      deliveryRules: counts[6]?.c || 0,
      channels: counts[7]?.c || 0,
      settings: counts[8]?.c || 0,
      logs: counts[9]?.c || 0,
      tableCount,
      driver: state.dbDriver,
      appName: config.public.appName,
      appVersion: config.public.appVersion,
      uptime: process.uptime ? Math.floor(process.uptime()) : 0,
    })
  }),
)
