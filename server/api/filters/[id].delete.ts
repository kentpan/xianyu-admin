/**
 * DELETE /api/filters/:id — 删除消息过滤规则。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id || Number.isNaN(id)) throw new ApiError(400, '无效的规则 ID')

    const existing = await db.get<any>('SELECT id FROM message_filters WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '过滤规则不存在')

    await db.run('DELETE FROM message_filters WHERE id = ?', [id])
    return ok({ id }, '过滤规则已删除')
  }),
)
