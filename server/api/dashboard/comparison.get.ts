/**
 * GET /api/dashboard/comparison — data comparison (today vs yesterday, this week vs last week).
 * Returns order counts + revenue for 4 periods: today, yesterday, thisWeek, lastWeek.
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterdayStart = new Date(todayStart.getTime() - 86400000)
    const weekStart = new Date(todayStart.getTime() - ((now.getDay() + 6) % 7) * 86400000) // Monday
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000)

    function dateStr(d: Date): string {
      return d.toISOString().slice(0, 10)
    }

    // SQLite date comparison
    const periods = {
      today: { from: dateStr(todayStart), to: dateStr(todayStart) },
      yesterday: { from: dateStr(yesterdayStart), to: dateStr(yesterdayStart) },
      thisWeek: { from: dateStr(weekStart), to: dateStr(todayStart) },
      lastWeek: { from: dateStr(lastWeekStart), to: dateStr(new Date(weekStart.getTime() - 86400000)) },
    }

    const result: Record<string, { orders: number; revenue: number }> = {}

    for (const [key, p] of Object.entries(periods)) {
      const row = await db.get<{ c: number; rev: number }>(
        `SELECT COUNT(*) as c, COALESCE(SUM(CAST(amount AS REAL)), 0) as rev
         FROM orders
         WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`,
        [p.from, p.to],
      ).catch(() => ({ c: 0, rev: 0 }))
      result[key] = { orders: row?.c || 0, revenue: Math.round((row?.rev || 0) * 100) / 100 }
    }

    // Compute deltas
    const todayVsYesterday = {
      orders: result.today.orders - result.yesterday.orders,
      revenue: Math.round((result.today.revenue - result.yesterday.revenue) * 100) / 100,
      ordersPct: result.yesterday.orders > 0 ? Math.round(((result.today.orders - result.yesterday.orders) / result.yesterday.orders) * 100) : (result.today.orders > 0 ? 100 : 0),
      revenuePct: result.yesterday.revenue > 0 ? Math.round(((result.today.revenue - result.yesterday.revenue) / result.yesterday.revenue) * 100) : (result.today.revenue > 0 ? 100 : 0),
    }
    const weekVsLastWeek = {
      orders: result.thisWeek.orders - result.lastWeek.orders,
      revenue: Math.round((result.thisWeek.revenue - result.lastWeek.revenue) * 100) / 100,
      ordersPct: result.lastWeek.orders > 0 ? Math.round(((result.thisWeek.orders - result.lastWeek.orders) / result.lastWeek.orders) * 100) : (result.thisWeek.orders > 0 ? 100 : 0),
      revenuePct: result.lastWeek.revenue > 0 ? Math.round(((result.thisWeek.revenue - result.lastWeek.revenue) / result.lastWeek.revenue) * 100) : (result.thisWeek.revenue > 0 ? 100 : 0),
    }

    return ok({
      periods: result,
      comparison: {
        todayVsYesterday,
        weekVsLastWeek,
      },
    })
  }),
)
