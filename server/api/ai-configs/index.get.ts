/**
 * GET /api/ai-configs — AI 配置中心分页列表。
 * Query: page (默认 1), pageSize (默认 20), keyword (名称/模型模糊搜索), enabled (all|1|0)
 * 登录用户均可读取 (账号级/商品级 AI 配置下拉数据源), api_key 一律脱敏。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize || 20)))
    const keyword = (q.keyword || '').toString().trim()
    const enabled = (q.enabled || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (keyword) {
      where.push('(name LIKE ? OR model_name LIKE ? OR remark LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (enabled === '1' || enabled === '0') {
      where.push('enabled = ?')
      params.push(Number(enabled))
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ai_configs ${whereSql}`, params)
    const total = totalRow?.c || 0
    const offset = (page - 1) * pageSize

    const rows = await db.all<any>(
      `SELECT id, name, model_name, base_url, enabled, remark, created_at, updated_at,
        CASE WHEN IFNULL(api_key, '') != '' THEN 1 ELSE 0 END AS has_api_key
       FROM ai_configs
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    for (const r of rows) r.api_key_masked = !!r.has_api_key

    return ok({ data: rows, total, page, pageSize })
  }),
)
