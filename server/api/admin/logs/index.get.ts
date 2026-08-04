/** GET /api/admin/logs — paginated system_logs with filters. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize || 20)))
    const level = (q.level || '').toString().trim().toUpperCase()
    const module = (q.module || '').toString().trim()
    const keyword = (q.keyword || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (level && level !== 'ALL') { where.push('level = ?'); params.push(level) }
    if (module) { where.push('module LIKE ?'); params.push(`%${module}%`) }
    if (keyword) { where.push('message LIKE ?'); params.push(`%${keyword}%`) }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM system_logs ${whereSql}`, params)
    const total = totalRow?.c || 0
    const offset = (page - 1) * pageSize

    const rows = await db.all(
      `SELECT id, level, module, message, meta, user_id, created_at
       FROM system_logs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    return ok({ data: rows, total, page, pageSize })
  }),
)
