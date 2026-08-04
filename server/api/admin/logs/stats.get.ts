/** GET /api/admin/logs/stats — log counts grouped by level. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const rows = await db.all<{ level: string; c: number }>(
      'SELECT level, COUNT(*) as c FROM system_logs GROUP BY level ORDER BY c DESC',
    )
    const stats: Record<string, number> = {}
    let total = 0
    for (const r of rows) {
      stats[r.level] = r.c
      total += r.c
    }
    return ok({ stats, total })
  }),
)
