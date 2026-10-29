/**
 * GET /api/listener/status — 监听引擎运行状态。
 *
 * 引擎存活判定 (如实反映, 不拿账号状态冒充引擎状态):
 *   - 内置引擎: 进程内调度器运行中 (isBuiltinEngineRunning) 或心跳 (engines.last_seen_at) 新鲜 ≤ 60s
 *   - 远程代理: last_seen_at 新鲜 ≤ 60s
 * 账号状态为每账号独立心跳: listening/connecting/reconnecting/risk_cooldown/need_relogin/error
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const rows = await db.all<any>(
      `SELECT c.id, c.remark, c.username, c.cookie_status_text, c.last_check_at,
              COALESCE(cs.enabled, 1) AS enabled
       FROM cookies c
       LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
       ORDER BY c.created_at ASC`,
    )

    const now = Date.now()
    const FRESH_MS = 60_000
    let managed = 0
    let listening = 0
    let connecting = 0
    let needRelogin = 0
    let errored = 0

    // token 风控连败状态 (进程内共享): 连败 ≥2 且持有验证页链接 → 全局弹窗人工滑块
    const verifyMap = new Map(getAllVerifyStates().map((s) => [s.cookieId, s]))

    const accounts = rows.map((r) => {
      const statusText = r.cookie_status_text || ''
      const lastCheck = r.last_check_at
        ? new Date(r.last_check_at + 'Z').getTime() || new Date(r.last_check_at).getTime()
        : 0
      const heartbeatFresh = !!lastCheck && now - lastCheck < FRESH_MS
      const state = r.enabled ? (heartbeatFresh ? statusText || 'connecting' : 'engine_offline') : 'disabled'
      const vs = verifyMap.get(r.id)
      const streak = vs?.streak || 0
      const needManualVerify =
        !!r.enabled && !!vs?.punishUrl && streak >= 2 && !['listening', 'need_relogin', 'disabled'].includes(state)
      if (r.enabled) {
        managed++
        if (state === 'listening') listening++
        else if (['connecting', 'reconnecting'].includes(state)) connecting++
        else if (state === 'need_relogin') needRelogin++
        else if (['error', 'risk_cooldown'].includes(state)) errored++
      }
      return {
        id: r.id,
        remark: r.remark || '',
        username: r.username || '',
        enabled: !!r.enabled,
        state,
        status_text: statusText,
        last_check_at: r.last_check_at || null,
        token_fail_streak: streak,
        need_manual_verify: needManualVerify,
      }
    })

    const verifyNeeded = accounts
      .filter((a) => a.need_manual_verify)
      .map((a) => ({ id: a.id, remark: a.remark, username: a.username, streak: a.token_fail_streak }))

    // 内置引擎存活: 进程内调度器真实运行状态优先, 心跳新鲜度兜底 (跨进程/重启后也如实)
    const engineRows = await db.all<any>(`SELECT slug, type, is_active, last_seen_at FROM engines`)
    const parseTs = (v: any) => (v ? new Date(String(v).replace(' ', 'T') + 'Z').getTime() || 0 : 0)
    const builtinRow = engineRows.find((e) => e.slug === 'builtin')
    const remoteRows = engineRows.filter((e) => e.type === 'remote' && e.is_active === 1)
    const inProcessRunning = typeof isBuiltinEngineRunning === 'function' ? isBuiltinEngineRunning() : false
    const builtinHeartbeatFresh = !!builtinRow?.last_seen_at && now - parseTs(builtinRow.last_seen_at) < FRESH_MS
    const builtinOnline = inProcessRunning || builtinHeartbeatFresh
    const remoteOnline = remoteRows.some((e) => now - parseTs(e.last_seen_at) < FRESH_MS)
    const engineRunning = builtinOnline || remoteOnline

    // 引擎相关系统设置回显
    const settingRows = await db.all<any>(
      `SELECT key_name, value FROM system_settings
       WHERE key_name IN ('order_sync_enabled','order_sync_interval','auto_polish_enabled','item_sync_enabled','item_sync_interval')`,
    )
    const settings: Record<string, string> = {}
    for (const s of settingRows) settings[s.key_name] = s.value

    return ok({
      engine_online: engineRunning,
      managed,
      listening,
      connecting,
      need_relogin: needRelogin,
      errored,
      settings,
      accounts,
      verify_needed: verifyNeeded,
    })
  }),
)
