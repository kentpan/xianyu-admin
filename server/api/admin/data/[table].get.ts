/** GET /api/admin/data/:table — paginated rows of a table. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const table = (getRouterParam(event, 'table') || '').trim()
    if (!isWhitelistedTable(table)) throw new ApiError(400, '该表不在可访问白名单内')

    const db = await getDb()
    const q = getQuery(event)
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize || 20)))

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${table}`)
    const total = totalRow?.c ?? 0
    const offset = (page - 1) * pageSize

    const rows = await db.all(
      `SELECT * FROM ${table} ORDER BY ${pkOf(table)} DESC LIMIT ? OFFSET ?`,
      [pageSize, offset],
    )

    return ok({ table, columns: rows.length ? Object.keys(rows[0]) : [], rows, total, page, pageSize })
  }),
)
