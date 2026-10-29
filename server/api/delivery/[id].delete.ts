/** DELETE /api/delivery/:id — delete a delivery rule. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的规则 ID')
    const db = await getDb()
    const r = await db.run('DELETE FROM delivery_rules WHERE id = ?', [id])
    if (!r.changes) throw new ApiError(404, '规则不存在')
    return ok({ id }, '规则已删除')
  }),
)
