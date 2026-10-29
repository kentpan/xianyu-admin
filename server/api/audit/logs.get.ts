/** GET /api/audit/logs — list audit logs with pagination + filters. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    await ensureTable().catch(() => {})

    const q = getQuery(event)
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize || 20)))
    const action = (q.action || '').toString().trim()
    const module = (q.module || '').toString().trim()
    const keyword = (q.keyword || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (action) { where.push('action = ?'); params.push(action) }
    if (module) { where.push('module = ?'); params.push(module) }
    if (keyword) {
      where.push('(description LIKE ? OR username LIKE ? OR target_id LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM audit_logs ${whereSql}`, params)
    const total = totalRow?.c || 0
    const offset = (page - 1) * pageSize

    const rows = await db.all(
      `SELECT id, user_id, username, action, module, target_type, target_id, description, ip_address, created_at
       FROM audit_logs ${whereSql}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    ).catch(() => [])

    // Get distinct actions + modules for filter dropdowns
    const actions = await db.all<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action').catch(() => [])
    const modules = await db.all<{ module: string }>('SELECT DISTINCT module FROM audit_logs WHERE module IS NOT NULL ORDER BY module').catch(() => [])

    return ok({
      data: rows,
      total,
      page,
      pageSize,
      actions: actions.map((a) => a.action),
      modules: modules.map((m) => m.module),
    })
  }),
)
