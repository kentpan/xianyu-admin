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

    // 运行时承载拦截: cloudflare(workerd) 无常驻进程/无 WebSocket 客户端,
    // 内置引擎物理上无法服务 —— 激活它只会得到一个永远"未运行"的死引擎。
    // 从源头拦住, 引导用户部署独立代理 (scripts/xianyu-proxy.mjs) 后再切换。
    if (row.type === 'builtin' && detectRuntime() === 'cloudflare') {
      throw new ApiError(
        400,
        'Cloudflare Pages 运行时无常驻进程, 内置监听引擎不可用。请在任意能出网的机器上部署独立代理 (scripts/xianyu-proxy.mjs, 部署说明见引擎行「部署」按钮), 代理上线后将其「设为使用」',
      )
    }

    await db.run('UPDATE engines SET is_active = 0, updated_at = CURRENT_TIMESTAMP')
    await db.run('UPDATE engines SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id])

    return ok({ active_slug: row.slug, active_name: row.name }, `已切换为使用「${row.name}」`)
  }),
)
