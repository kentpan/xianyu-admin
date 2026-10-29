/**
 * GET /api/api-keys/:id/stats — API Key 调用统计报表 (仅管理员)。
 * 返回: 累计总量/成败 + 近 24h 按小时 + 近 7 天按天 (JS 聚合, 跨驱动兼容)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, '无效的 API Key ID')

    const key = await db.get<any>('SELECT id, name, total_calls, total_success, total_failed, last_used_at, created_at FROM api_keys WHERE id = ?', [id])
    if (!key) throw new ApiError(404, 'API Key 不存在')

    const logs = await db.all<any>(
      'SELECT created_at, success FROM api_key_logs WHERE api_key_id = ? AND created_at > ?',
      [id, new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')],
    )

    // 小时桶 (近 24h) / 天桶 (近 7d); CURRENT_TIMESTAMP 为 UTC, 统一按 UTC 聚合再本地化展示
    const hourBuckets = new Map<string, { total: number; success: number }>()
    const dayBuckets = new Map<string, { total: number; success: number }>()
    for (let i = 23; i >= 0; i--) {
      const d = new Date(Date.now() - i * 3_600_000)
      hourBuckets.set(d.toISOString().slice(0, 13), { total: 0, success: 0 })
    }
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000)
      dayBuckets.set(d.toISOString().slice(0, 10), { total: 0, success: 0 })
    }
    for (const l of logs) {
      const t = String(l.created_at || '').replace(' ', 'T')
      const ts = Date.parse(`${t}${t.length === 19 ? 'Z' : ''}`)
      if (!Number.isFinite(ts)) continue
      const hourKey = new Date(ts).toISOString().slice(0, 13)
      const dayKey = new Date(ts).toISOString().slice(0, 10)
      const hb = hourBuckets.get(hourKey)
      if (hb) {
        hb.total++
        if (Number(l.success)) hb.success++
      }
      const dbk = dayBuckets.get(dayKey)
      if (dbk) {
        dbk.total++
        if (Number(l.success)) dbk.success++
      }
    }

    const hourly = Array.from(hourBuckets.entries()).map(([k, v]) => ({ bucket: k, ...v }))
    const daily = Array.from(dayBuckets.entries()).map(([k, v]) => ({ bucket: k, ...v }))

    return ok({
      totals: {
        total_calls: key.total_calls || 0,
        total_success: key.total_success || 0,
        total_failed: key.total_failed || 0,
        calls_24h: hourly.reduce((s, h) => s + h.total, 0),
        last_used_at: key.last_used_at || null,
      },
      hourly,
      daily,
    })
  }),
)
