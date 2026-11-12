/**
 * POST /api/engines/builtin-start — 重新启动内置监听引擎 (解除手动停止开关)。
 *
 * 清除 system_settings.builtin_engine_disabled (共库全局, 所有内置引擎 5s 内恢复巡检);
 * Node 运行时本进程调度器立即拉起 (幂等), 是否真正服务仍由门控巡检决定:
 * engines.is_active === builtin 才建连, 否则待命并按失联仲裁语义接管。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()

    await setBuiltinEngineDisabled(db, false)
    if (detectRuntime() === 'node') {
      startBuiltinEngineSupervisor()
    }
    await db
      .run("UPDATE engines SET last_status = '手动停止已解除', updated_at = CURRENT_TIMESTAMP WHERE slug = 'builtin'")
      .catch(() => {})
    await db
      .run("INSERT INTO system_logs (level, module, message) VALUES ('INFO', 'engine', '内置监听引擎手动停止已解除 (监听服务页)')")
      .catch(() => {})

    return ok({ disabled: false }, '内置监听引擎已解除停止: 巡检已恢复, 是否接管监听仍按引擎切换状态与失联仲裁决定')
  }),
)
