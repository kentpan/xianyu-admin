/** DELETE /api/notifications/messages/batch/:cookieId — delete all message notifications for a cookie. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    if (!cookieId) throw new ApiError(400, '缺少 cookie_id')
    const db = await getDb()
    const r = await db.run('DELETE FROM message_notifications WHERE cookie_id = ?', [cookieId])
    return ok({ cookie_id: cookieId, deleted: r.changes }, `已删除 ${r.changes} 条通知关系`)
  }),
)
