/** PUT /api/affiliate/accounts/:id — 启停 / 备注。 Body: { enabled?, remark? } */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的 id')
    const body = await readBody(event)

    const row = await db.get<any>('SELECT id, user_id FROM affiliate_accounts WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && row.user_id !== payload.userId) throw new ApiError(403, '无权操作')

    const sets: string[] = []
    const params: any[] = []
    if (body?.enabled !== undefined) { sets.push('enabled = ?'); params.push(body.enabled ? 1 : 0) }
    if (body?.remark !== undefined) { sets.push('remark = ?'); params.push(String(body.remark)) }
    if (!sets.length) throw new ApiError(400, '无更新字段')
    sets.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)
    await db.run(`UPDATE affiliate_accounts SET ${sets.join(', ')} WHERE id = ?`, params)
    return ok({ id }, '已更新')
  }),
)
