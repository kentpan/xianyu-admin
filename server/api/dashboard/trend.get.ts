/** GET /api/dashboard/trend — 7-day order trend (counts + revenue per day). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    // Build last 7 days (including today) — 北京日历日 (v2.3.0): DB 存 UTC, +8h 取北京日期
    const days: { date: string; label: string; count: number; revenue: number }[] = []
    const bjNow = new Date(Date.now() + 8 * 3600 * 1000)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(bjNow)
      d.setUTCDate(d.getUTCDate() - i)
      const key = d.toISOString().slice(0, 10) // YYYY-MM-DD (北京日历日)
      const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
      days.push({ date: key, label, count: 0, revenue: 0 })
    }

    // SQLite stores created_at as UTC; group by 北京日期 (+8h)
    const rows = await db.all<{ d: string; c: number; rev: number }>(
      `SELECT substr(datetime(created_at, '+8 hours'), 1, 10) as d, COUNT(*) as c, COALESCE(SUM(CAST(amount AS REAL)), 0) as rev
       FROM orders
       WHERE created_at >= datetime('now', '-7 days', '-8 hours')
       GROUP BY substr(datetime(created_at, '+8 hours'), 1, 10)`,
    ).catch(async () => {
      // Fallback: scan all and group in JS (for memory/d1 adapters)
      const all = await db.all<{ created_at: string; amount: string }>('SELECT created_at, amount FROM orders')
      const map: Record<string, { c: number; rev: number }> = {}
      for (const o of all) {
        const ms = Date.parse((o.created_at || '').replace(' ', 'T') + 'Z')
        if (Number.isNaN(ms)) continue
        const d = new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
        if (!d) continue
        if (!map[d]) map[d] = { c: 0, rev: 0 }
        map[d].c++
        map[d].rev += Number(o.amount) || 0
      }
      return Object.entries(map).map(([d, v]) => ({ d, c: v.c, rev: v.rev }))
    })

    for (const r of rows) {
      const day = days.find((x) => x.date === r.d)
      if (day) {
        day.count = r.c
        day.revenue = Math.round(r.rev * 100) / 100
      }
    }

    return ok({
      days,
      totalOrders: days.reduce((s, d) => s + d.count, 0),
      totalRevenue: Math.round(days.reduce((s, d) => s + d.revenue, 0) * 100) / 100,
    })
  }),
)
