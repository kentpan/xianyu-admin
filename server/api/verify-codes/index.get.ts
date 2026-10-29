/**
 * GET /api/verify-codes — 提货验证码记录分页 (仅管理员)。
 * Query: page, pageSize (默认 20), keyword (验证码/订单号/买家模糊), status (unused|used)
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const q = getQuery(event)
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize || 20)))
    const keyword = (q.keyword || '').toString().trim()
    const status = (q.status || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (keyword) {
      where.push('(code LIKE ? OR order_id LIKE ? OR buyer_id LIKE ? OR item_id LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (status === 'used' || status === 'unused') {
      where.push('status = ?')
      params.push(status)
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM verify_codes ${whereSql}`, params)
    const rows = await db.all<any>(
      `SELECT v.*, k.name AS used_by_key_name
       FROM verify_codes v
       LEFT JOIN api_keys k ON k.id = v.used_by_key_id
       ${whereSql}
       ORDER BY v.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    )

    const statRow = await db.get<{ total: number; used: number }>(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN status = \'used\' THEN 1 ELSE 0 END) AS used FROM verify_codes',
    )

    return ok({
      data: rows,
      total: totalRow?.c || 0,
      page,
      pageSize,
      stats: { total: statRow?.total || 0, used: statRow?.used || 0 },
    })
  }),
)
