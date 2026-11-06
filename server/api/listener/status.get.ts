/**
 * GET /api/listener/status — 监听引擎运行状态。
 *
 * 引擎存活判定 (如实反映, 不拿账号状态冒充引擎状态):
 *   - 内置引擎: 进程内调度器运行中 (isBuiltinEngineRunning) 或心跳 (engines.last_seen_at) 新鲜 ≤ 60s
 *   - 远程代理: 登记地址 /health 实测 (未登记地址回退 last_seen_at 新鲜度 ≤ 60s)
 * 账号状态为每账号独立心跳: listening/connecting/reconnecting/risk_cooldown/need_relogin/error
 */
import { probeEngines } from '../../utils/xianyu/engine-probe'

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

    // (v2.3.4) 引擎账号心跳快照: 代理状态心跳自 v2.3.4 起写单行快照 (system_settings,
    // 每轮 1 行), cookies 逐账号行仅在状态变化时落库。快照新鲜 → 快照状态/时间优先
    // (实时精度 = 心跳周期); 快照缺失或陈旧 (旧版代理未上报/快照链路异常) → 回落
    // cookies.last_check_at 原判定 — 新旧代理与回滚场景完全兼容, 判定语义不变。
    let hbSnap: Record<string, { t: number; s: string }> | null = null
    try {
      const hbRow = await db.get<{ value: string }>(
        "SELECT value FROM system_settings WHERE key_name = 'engine_account_heartbeat'",
      )
      if (hbRow?.value) {
        const parsed = JSON.parse(String(hbRow.value))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) hbSnap = parsed
      }
    } catch {
      /* 快照缺失/损坏 → 回落 cookies 判定 */
    }

    const now = Date.now()
    const FRESH_MS = 60_000
    let managed = 0
    let listening = 0
    let connecting = 0
    let needRelogin = 0
    let errored = 0

    // token 风控连败状态 (进程内共享): 连败 ≥2 且持有验证页链接 → 全局弹窗人工滑块
    const verifyMap = new Map(getAllVerifyStates().map((s) => [s.cookieId, s]))

    // 快照时间戳 → SQLite CURRENT_TIMESTAMP 同格式 (YYYY-MM-DD HH:MM:SS, UTC 无 Z,
    // 前端按 +Z 解析), 保持 last_check_at 输出格式不变
    const fmtTs = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

    const accounts = rows.map((r) => {
      const statusText = r.cookie_status_text || ''
      const lastCheck = r.last_check_at
        ? new Date(r.last_check_at + 'Z').getTime() || new Date(r.last_check_at).getTime()
        : 0
      const cookiesFresh = !!lastCheck && now - lastCheck < FRESH_MS
      const hb = hbSnap ? hbSnap[String(r.id)] : undefined
      const hbFresh = !!hb && Number.isFinite(hb.t) && now - hb.t < FRESH_MS
      const heartbeatFresh = hbFresh || cookiesFresh
      // 快照新鲜 → 快照状态文本优先 (代理上报的实时状态); 否则维持 cookies 状态文本
      const effStatusText = hbFresh && hb!.s ? hb!.s : statusText
      const state = r.enabled ? (heartbeatFresh ? effStatusText || 'connecting' : 'engine_offline') : 'disabled'
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
        status_text: effStatusText,
        last_check_at: hbFresh ? fmtTs(hb!.t) : r.last_check_at || null,
        token_fail_streak: streak,
        need_manual_verify: needManualVerify,
      }
    })

    const verifyNeeded = accounts
      .filter((a) => a.need_manual_verify)
      .map((a) => ({ id: a.id, remark: a.remark, username: a.username, streak: a.token_fail_streak }))

    // 内置引擎存活: 进程内调度器真实运行状态优先, 心跳新鲜度兜底 (跨进程/重启后也如实)
    // 远程代理存活: 登记地址 /health 实测 (与引擎列表同一判定源);
    //   实测失败时回退「回连来源核验」: 心跳新鲜 且 回连来源 IP 与登记 host 一致 (cf-connecting-ip/XFF 不可伪造)
    const engineRows = await db.all<any>(
      `SELECT slug, type, is_active, host, port, last_seen_at, last_poll_ip FROM engines`,
    )
    const parseTs = (v: any) => (v ? new Date(String(v).replace(' ', 'T') + 'Z').getTime() || 0 : 0)
    const builtinRow = engineRows.find((e) => e.slug === 'builtin')
    const remoteRows = engineRows.filter((e) => e.type === 'remote' && e.is_active === 1)
    const inProcessRunning = typeof isBuiltinEngineRunning === 'function' ? isBuiltinEngineRunning() : false
    const builtinHeartbeatFresh = !!builtinRow?.last_seen_at && now - parseTs(builtinRow.last_seen_at) < FRESH_MS
    const builtinOnline = inProcessRunning || builtinHeartbeatFresh

    const withAddr = remoteRows.filter((e) => e.host && e.port)
    const remoteProbes = withAddr.length
      ? await probeEngines(withAddr.map((e) => ({ id: e.id, host: e.host, port: e.port })))
      : new Map()
    const pollVerified = (e: any) =>
      !!e.host &&
      now - parseTs(e.last_seen_at) < FRESH_MS &&
      !!e.last_poll_ip &&
      String(e.last_poll_ip) === String(e.host).trim()
    const remoteOnline = withAddr.length
      ? [...remoteProbes.values()].some((p) => p.ok && p.engine_active) || remoteRows.some((e) => pollVerified(e))
      : remoteRows.some((e) => now - parseTs(e.last_seen_at) < FRESH_MS)

    // 引擎状态 = 当前「使用中」引擎是否真实在服务:
    // 内置引擎待命 (远程代理使用中) 时其心跳不冒充引擎存活
    const activeEngine = engineRows.find((e) => e.is_active === 1)
    const engineRunning = activeEngine ? (activeEngine.slug === 'builtin' ? builtinOnline : remoteOnline) : false

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
