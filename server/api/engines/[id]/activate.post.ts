/**
 * POST /api/engines/:id/activate — 切换当前使用的监听引擎。
 *
 * 切换后:
 *   1. engines.is_active 全表归零, 目标引擎置 1 (同一时刻只有一个引擎服务)
 *   2. listener_reload_requested 置 true — 所有引擎每 5s 轮询该标记,
 *      逐一比对 engines.is_active 与自身部署身份 (XY_ENGINE_SLUG):
 *      被停用的引擎自动停止全部账号任务, 被启用的引擎自动拉起监听。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的引擎 ID')
    const db = await getDb()

    const row = await db.get<any>('SELECT * FROM engines WHERE id = ?', [id])
    if (!row) throw new ApiError(404, '引擎不存在')
    if (!row.enabled) throw new ApiError(400, '该引擎已停用, 请先启用再切换')

    await db.run('UPDATE engines SET is_active = 0, updated_at = CURRENT_TIMESTAMP')
    await db.run('UPDATE engines SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id])

    return ok({ active_slug: row.slug, active_name: row.name }, `已切换为使用「${row.name}」`)
  }),
)
