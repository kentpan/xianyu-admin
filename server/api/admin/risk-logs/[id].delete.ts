/** DELETE /api/admin/risk-logs/:id — delete a risk log entry. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的日志 ID')
    const db = await getDb()
    const r = await db.run('DELETE FROM risk_control_logs WHERE id = ?', [id])
    if (!r.changes) throw new ApiError(404, '日志不存在')
    return ok({ id }, '已删除')
  }),
)
