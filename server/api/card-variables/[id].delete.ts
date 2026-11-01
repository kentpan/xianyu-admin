/** DELETE /api/card-variables/:id — 删除自定义变量 (内置变量不可删)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const id = Math.round(Number(getRouterParam(event, 'id')) || 0)
    const row = await db.get<any>('SELECT id, var_key, builtin FROM card_variables WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '变量不存在')
    if (Number(row.builtin) === 1) throw new ApiError(400, `内置变量 {${row.var_key}} 不可删除, 可停用隐藏`)
    await db.run('DELETE FROM card_variables WHERE id = ?', [id])
    return ok({ id }, '变量已删除')
  }),
)
