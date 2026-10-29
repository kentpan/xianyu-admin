/**
 * GET /api/api-keys — API Key 管理列表 (仅管理员)。
 * Query: page (默认 1), pageSize (默认 20), keyword (名称/Key/备注模糊), enabled (1|0)
 * 返回 Key 明文 (后台可反复查看+复制) + 调用统计 (总量/成败/24h)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize || 20)))
    const keyword = (q.keyword || '').toString().trim()
    const enabled = (q.enabled || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (keyword) {
      where.push('(name LIKE ? OR api_key LIKE ? OR remark LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (enabled === '1' || enabled === '0') {
      where.push('enabled = ?')
      params.push(Number(enabled))
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM api_keys ${whereSql}`, params)
    const total = totalRow?.c || 0
    const offset = (page - 1) * pageSize

    const rows = await db.all<any>(
      `SELECT * FROM api_keys ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    // 24h 调用量 (JS 聚合, 跨驱动兼容)
    const ids = rows.map((r) => r.id)
    const calls24h: Record<number, number> = {}
    if (ids.length) {
      const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ')
      const logs = await db.all<any>(
        `SELECT api_key_id, created_at FROM api_key_logs WHERE created_at > ? AND api_key_id IN (${ids.map(() => '?').join(',')})`,
        [since, ...ids],
      )
      for (const l of logs) calls24h[l.api_key_id] = (calls24h[l.api_key_id] || 0) + 1
    }
    for (const r of rows) r.calls_24h = calls24h[r.id] || 0

    return ok({ data: rows, total, page, pageSize })
  }),
)
