/** DELETE /api/admin/data/:table — truncate a table (whitelist only, block users). */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const table = (getRouterParam(event, 'table') || '').trim()
    if (!isWhitelistedTable(table)) throw new ApiError(400, '该表不在可访问白名单内')
    if (table === 'users') throw new ApiError(400, '不能清空 users 表')

    const body = await readBody(event).catch(() => ({})) || {}
    if (!body.confirm) throw new ApiError(400, '请在请求体中传入 confirm: true 以确认清空操作')

    const db = await getDb()
    const r = await db.run(`DELETE FROM ${table}`, [])
    return ok({ table, deleted: r.changes }, `已清空表 ${table}`)
  }),
)
