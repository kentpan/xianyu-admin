/** DELETE /api/admin/data/:table/:id — delete a single row by primary key. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const table = (getRouterParam(event, 'table') || '').trim()
    const id = getRouterParam(event, 'id') || ''
    if (!isWhitelistedTable(table)) throw new ApiError(400, '该表不在可访问白名单内')
    if (!id) throw new ApiError(400, '缺少主键值')

    const db = await getDb()
    const pk = pkOf(table)
    const r = await db.run(`DELETE FROM ${table} WHERE ${pk} = ?`, [id])
    if (!r.changes) throw new ApiError(404, '未找到要删除的行')
    return ok({ table, id }, '已删除')
  }),
)
