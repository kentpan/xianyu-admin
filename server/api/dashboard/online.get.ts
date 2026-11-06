/** GET /api/dashboard/online — account online status summary (enabled accounts, last activity, cookie freshness). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const accounts = await db.all<{
      id: string; remark: string; enabled: number; auto_confirm: number; created_at: string
    }>(`
      SELECT c.id, c.remark, COALESCE(cs.enabled, 1) as enabled, c.auto_confirm, c.created_at
      FROM cookies c
      LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
      ORDER BY c.created_at DESC
    `).catch(() => [])

    // Get per-account stats
    const ids = accounts.map((a) => a.id)
    let orderStats: { cookie_id: string; c: number; last: string }[] = []
    let kwStats: { cookie_id: string; c: number }[] = []
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',')
      orderStats = await db.all(
        `SELECT cookie_id, COUNT(*) as c, MAX(created_at) as last FROM orders WHERE cookie_id IN (${placeholders}) GROUP BY cookie_id`,
        ids,
      ).catch(() => [])
      kwStats = await db.all(
        `SELECT cookie_id, COUNT(*) as c FROM keywords WHERE cookie_id IN (${placeholders}) GROUP BY cookie_id`,
        ids,
      ).catch(() => [])
    }

    const ordMap = new Map(orderStats.map((r) => [r.cookie_id, { c: r.c, last: r.last }]))
    const kwMap = new Map(kwStats.map((r) => [r.cookie_id, r.c]))

    const items = accounts.map((a) => {
      const ord = ordMap.get(a.id)
      const kw = kwMap.get(a.id) || 0
      const created = new Date(String(a.created_at).replace(' ', 'T')).getTime() || 0
      const now = Date.now()
      const ageHours = created ? Math.floor((now - created) / 3600000) : 0
      return {
        id: a.id,
        remark: a.remark || a.id,
        enabled: !!a.enabled,
        autoConfirm: !!a.auto_confirm,
        keywordCount: kw,
        orderCount: ord?.c || 0,
        lastOrderAt: ord?.last || null,
        ageHours,
        // "online" = enabled && has activity in last 24h (or created recently)
        isOnline: !!a.enabled && (ageHours < 24 || (ord?.last && (now - new Date(String(ord.last).replace(' ', 'T')).getTime()) < 86400000)),
      }
    })

    const online = items.filter((i) => i.isOnline).length
    const offline = items.filter((i) => !i.isOnline && i.enabled).length
    const disabled = items.filter((i) => !i.enabled).length

    return ok({
      items,
      summary: { total: items.length, online, offline, disabled },
    })
  }),
)
