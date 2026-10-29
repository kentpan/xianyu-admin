/**
 * DELETE /api/distribution/dock-records/:id — 删除自己的对接记录
 *
 * 仅创建者或管理员可操作
 * 二级对接记录直接删除; 一级对接记录被删除时, 关联的二级对接记录也一并删除
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的对接记录 ID')
    const db = await getDb()

    const dock = await db.get<{ id: number; user_id: number; level: number }>(
      'SELECT id, user_id, level FROM dock_records WHERE id = ?',
      [id],
    )
    if (!dock) throw new ApiError(404, '对接记录不存在')

    if (dock.user_id !== payload.userId && !payload.isAdmin) {
      throw new ApiError(403, '无权删除该对接记录')
    }

    await db.transaction(async () => {
      // 一级记录删除时, 同时清理其下属的二级记录
      if (dock.level === 1) {
        await db.run('DELETE FROM dock_records WHERE parent_dock_id = ?', [id])
      }
      await db.run('DELETE FROM dock_records WHERE id = ?', [id])
    })

    return ok({ id }, '已删除')
  }),
)
