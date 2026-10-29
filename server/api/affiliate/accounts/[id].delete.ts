/** DELETE /api/affiliate/accounts/:id — 删除联盟账号。 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的 id')

    const row = await db.get<any>('SELECT id, user_id, network_id, display_name FROM affiliate_accounts WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && row.user_id !== payload.userId) throw new ApiError(403, '无权操作')

    await db.run('DELETE FROM affiliate_accounts WHERE id = ?', [id])
    await db.run('DELETE FROM affiliate_products WHERE account_id = ?', [id])
    await auditLog(event, { action: 'delete', module: 'affiliate-accounts', targetType: 'affiliate-account', targetId: String(id), desc: `删除联盟账号 ${row.display_name}` })
    return ok({ id }, '账号已删除')
  }),
)
