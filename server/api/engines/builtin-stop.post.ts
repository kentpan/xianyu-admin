/**
 * POST /api/engines/builtin-stop — 手动停止内置监听引擎 (监听服务页按钮)。
 *
 * 场景: 本地开发服务器连生产库启动时, 内置引擎随进程自动启动并可能抢占线上监听
 * (吊销代理授权 → 线上自动发货/消息/日志全链路静默)。本开关从源头根治:
 *   1. system_settings.builtin_engine_disabled = 'true' (共库全局持久化, 重启进程后保持停止)
 *   2. 本进程内置引擎调度器立即停止 + 全部账号连接下线
 *   3. 所有权立即归还远程代理 (owner=remote) — 线上代理下一轮配置轮询 (≤30s) 恢复监听
 * 所有共享该库的内置引擎每轮巡检 (5s) 都会遵守此开关, 哪怕停的是另一台机器上的进程。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const db = await getDb()

    await setBuiltinEngineDisabled(db, true)
    stopBuiltinEngineSupervisor()

    const active = await db.get<{ slug: string }>('SELECT slug FROM engines WHERE is_active = 1 LIMIT 1')
    let ownershipNote = ''
    if (active?.slug !== 'builtin') {
      await setFailoverOwner(db, FAILOVER_REMOTE)
      ownershipNote = '远程代理授权已归还 (代理 ≤30s 自动恢复监听)'
    }
    await db
      .run("UPDATE engines SET last_status = '手动停止 (监听服务页)', updated_at = CURRENT_TIMESTAMP WHERE slug = 'builtin'")
      .catch(() => {})
    await db
      .run("INSERT INTO system_logs (level, module, message) VALUES ('WARN', 'engine', ?)", [
        `内置监听引擎已手动停止 (监听服务页): 全部账号连接下线, 开关持久化 (重启进程后保持停止)${ownershipNote ? '; ' + ownershipNote : ''}`,
      ])
      .catch(() => {})

    return ok({ disabled: true }, `内置监听引擎已停止: 账号连接全部下线, 开关持久化${ownershipNote ? '; ' + ownershipNote : ''}`)
  }),
)
