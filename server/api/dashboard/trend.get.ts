/** GET /api/dashboard/trend — 7-day order trend (counts + revenue per day).
 *
 * v2.3.5 D1 额度保卫战: 服务端 120s TTL 缓存 (趋势是历史统计, 不需要实时);
 * WHERE created_at >= 范围条件命中 idx_orders_created 索引, 只扫 7 天内的行。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const data = await withTtlCache('dash:trend', 120_000, loadTrend)
    return ok(data)
  }),
)

async function loadTrend() {
  const db = await getDb()

    // Build last 7 days (including today) in Asia/Shanghai
    const days: { date: string; label: string; count: number; revenue: number }[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10) // YYYY-MM-DD
      const label = `${d.getMonth() + 1}/${d.getDate()}`
      days.push({ date: key, label, count: 0, revenue: 0 })
    }

    // SQLite stores created_at as ISO string; group by date prefix
    const rows = await db.all<{ d: string; c: number; rev: number }>(
      `SELECT substr(created_at, 1, 10) as d, COUNT(*) as c, COALESCE(SUM(CAST(amount AS REAL)), 0) as rev
       FROM orders
       WHERE created_at >= date('now', '-7 days')
       GROUP BY substr(created_at, 1, 10)`,
    ).catch(async () => {
      // Fallback: scan all and group in JS (for memory/d1 adapters)
      const all = await db.all<{ created_at: string; amount: string }>('SELECT created_at, amount FROM orders')
      const map: Record<string, { c: number; rev: number }> = {}
      for (const o of all) {
        const d = (o.created_at || '').slice(0, 10)
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

  return {
    days,
    totalOrders: days.reduce((s, d) => s + d.count, 0),
    totalRevenue: Math.round(days.reduce((s, d) => s + d.revenue, 0) * 100) / 100,
  }
}
