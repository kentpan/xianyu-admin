/**
 * GET /api/api-keys/:id/logs — API Key 调用日志分页 (仅管理员)。
 * Query: page, pageSize (默认 20, 上限 100)
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, '无效的 API Key ID')
    const q = getQuery(event)
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize || 20)))

    const existing = await db.get('SELECT id FROM api_keys WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, 'API Key 不存在')

    const totalRow = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM api_key_logs WHERE api_key_id = ?', [id])
    const rows = await db.all<any>(
      'SELECT * FROM api_key_logs WHERE api_key_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      [id, pageSize, (page - 1) * pageSize],
    )
    return ok({ data: rows, total: totalRow?.c || 0, page, pageSize })
  }),
)
