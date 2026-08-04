/** DELETE /api/accounts/:id — delete cookie and cascade-clean related rows. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()

    const existing = await db.get('SELECT id FROM cookies WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '账号不存在')

    await db.transaction(async () => {
      await db.run('DELETE FROM cookie_status WHERE cookie_id = ?', [id])
      await db.run('DELETE FROM keywords WHERE cookie_id = ?', [id])
      await db.run('DELETE FROM ai_reply_settings WHERE cookie_id = ?', [id])
      await db.run('DELETE FROM default_replies WHERE cookie_id = ?', [id])
      await db.run('DELETE FROM ai_conversations WHERE cookie_id = ?', [id])
      await db.run('DELETE FROM item_replay WHERE cookie_id = ?', [id])
      await db.run('DELETE FROM message_notifications WHERE cookie_id = ?', [id])
      await db.run('DELETE FROM item_info WHERE cookie_id = ?', [id])
      await db.run('DELETE FROM cookies WHERE id = ?', [id])
    })

    await auditLog(event, { action: 'delete', module: 'accounts', targetType: 'cookie', targetId: id, desc: `删除账号 ${id}` })
    return ok({ id }, '账号已删除')
  }),
)
