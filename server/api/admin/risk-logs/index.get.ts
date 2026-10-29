/** GET /api/admin/risk-logs — paginated risk_control_logs. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const q = getQuery(event)
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize || 20)))
    const cookie_id = (q.cookie_id || '').toString().trim()
    const status = (q.status || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (cookie_id) { where.push('cookie_id = ?'); params.push(cookie_id) }
    if (status) { where.push('processing_status = ?'); params.push(status) }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM risk_control_logs ${whereSql}`, params)
    const total = totalRow?.c || 0
    const offset = (page - 1) * pageSize
    const rows = await db.all(
      `SELECT id, cookie_id, event_type, event_description, processing_result,
              processing_status, error_message, created_at
       FROM risk_control_logs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    return ok({ data: rows, total, page, pageSize })
  }),
)
