/** GET /api/accounts/health — per-account health summary (keyword count, order count, ai enabled, last order time). */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    // Get all accounts with keyword counts
    const accounts = await db.all<{
      id: string; remark: string; enabled: number; auto_confirm: number; pause_duration: number; created_at: string
    }>(`
      SELECT c.id, c.remark, COALESCE(cs.enabled, 1) as enabled, c.auto_confirm, c.pause_duration, c.created_at
      FROM cookies c
      LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
      ORDER BY c.created_at DESC
    `)

    if (!accounts.length) return ok([])

    // Batch counts per account
    const ids = accounts.map((a) => a.id)
    const placeholders = ids.map(() => '?').join(',')

    const keywordCounts = await db.all<{ cookie_id: string; c: number }>(
      `SELECT cookie_id, COUNT(*) as c FROM keywords WHERE cookie_id IN (${placeholders}) GROUP BY cookie_id`,
      ids,
    ).catch(() => [])
    const orderCounts = await db.all<{ cookie_id: string; c: number; last: string }>(
      `SELECT cookie_id, COUNT(*) as c, MAX(created_at) as last FROM orders WHERE cookie_id IN (${placeholders}) GROUP BY cookie_id`,
      ids,
    ).catch(() => [])
    const aiSettings = await db.all<{ cookie_id: string; ai_enabled: number }>(
      `SELECT cookie_id, ai_enabled FROM ai_reply_settings WHERE cookie_id IN (${placeholders})`,
      ids,
    ).catch(() => [])

    const kwMap = new Map(keywordCounts.map((r) => [r.cookie_id, r.c]))
    const ordMap = new Map(orderCounts.map((r) => [r.cookie_id, { c: r.c, last: r.last }]))
    const aiMap = new Map(aiSettings.map((r) => [r.cookie_id, r.ai_enabled]))

    const result = accounts.map((a) => {
      const ord = ordMap.get(a.id)
      const kw = kwMap.get(a.id) || 0
      const ai = aiMap.get(a.id) || 0
      // Health score: enabled(40) + hasCookie(20) + keywords(20) + ai(10) + orders(10)
      let score = 0
      if (a.enabled) score += 40
      score += 20 // cookie always present (row exists)
      score += Math.min(kw, 5) * 4 // up to 20
      if (ai) score += 10
      if (ord && ord.c > 0) score += 10
      return {
        id: a.id,
        remark: a.remark || a.id,
        enabled: !!a.enabled,
        autoConfirm: !!a.auto_confirm,
        keywordCount: kw,
        orderCount: ord?.c || 0,
        lastOrderAt: ord?.last || null,
        aiEnabled: !!ai,
        healthScore: score,
        healthLevel: score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor',
      }
    })

    return ok(result)
  }),
)
