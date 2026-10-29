/**
 * DELETE /api/engines/:id — 删除远程监听引擎。
 * 内置引擎 (id=1/builtin) 不可删除; 使用中的引擎需先切换到其他引擎。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的引擎 ID')
    const db = await getDb()

    const row = await db.get<any>('SELECT * FROM engines WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '引擎不存在')
    if (row.type === 'builtin') throw new ApiError(400, '内置监听引擎不可删除')
    if (row.is_active) throw new ApiError(400, '该引擎正在使用中, 请先切换到其他引擎再删除')

    await db.run('DELETE FROM engines WHERE id = ?', [id])
    return ok({ id }, '引擎已删除')
  }),
)
