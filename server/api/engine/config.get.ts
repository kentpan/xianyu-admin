/**
 * GET /api/engine/config — 远程代理拉取监听配置 (轮询, 默认 30s)。
 *
 * 鉴权: 标准 `Authorization: Bearer <token>`。
 * active 授权双门控 (v2.3.2 双连接根治):
 *   1. engines.is_active=1 — 使用中引擎
 *   2. engine_failover.owner='remote' — 所有权未被内置引擎接管
 * 任一不满足即返回 active=false → 代理自动下线全部连接 (多引擎互斥, 防重复回复/风控雪崩)。
 * 内置引擎接管时立即置 owner=builtin 吊销授权 — 存活代理 ≤30s 内收到并退避,
 * 从源头消灭「代理与内置引擎双连接 → 平台风控要求重新登录+人脸核验」。
 *
 * 下发内容 = 纯连接所需: 账号 Cookie + 持久化设备指纹 + 轮询间隔。
 * 不下发任何业务规则/卡券/订单 — 业务状态只存在于本后台。
 */
import { getRequestURL } from 'h3'
import { consumeRate } from '../../utils/rate-limit'
import { getFailoverOwner, setFailoverOwner, FAILOVER_BUILTIN, FAILOVER_REMOTE } from '../../utils/xianyu/failover'
import { noteOwnSiteHost, normalizeSiteHost } from '../../utils/xianyu/site-origin'

export default defineEventHandler(
  withApi(async (event) => {
    const engine = await requireEngine(event)

    // 登记本站对外 host (代理回连请求的 Host 头): 共库多站点部署下, 内置引擎仲裁与
    // 监听页展示用它判定代理实际在服务哪个站点 (site-origin.ts)
    noteOwnSiteHost(getRequestURL(event).host)
    const pollHost = normalizeSiteHost(getRequestURL(event).host)

    const rl = consumeRate(`engine:${engine.id}`, { capacity: 40, perMinute: 120 })
    if (!rl.ok) {
      setHeader(event, 'Retry-After', String(rl.retryAfterSeconds))
      throw new ApiError(429, `配置拉取过于频繁, 请 ${rl.retryAfterSeconds}s 后重试`)
    }

    const db = await getDb()
    let owner = await getFailoverOwner(db)

    // 所有权残留自愈 (线上恢复入口): 活跃引擎是远程代理但 engine_failover 仍是 builtin —
    // 常见于「本地开发服务器连生产库 → 内置引擎接管 → 进程退出/被手动停止」的残留。
    // 此时代理永久拿不到 active=true, 线上监听静默死亡且 (CF 无内置引擎) 无任何修复路径。
    // 内置引擎心跳陈旧 (>120s, 正常每 10s 一次) = 没有任何内置引擎在服务 → 残留所有权
    // 立即归还代理; 内置引擎真实在服务 (心跳新鲜) 时绝不自愈, 所有权仲裁语义不变。
    if (owner === FAILOVER_BUILTIN && engine.is_active && engine.type !== 'builtin') {
      const builtinRow = await db
        .get<{ last_seen_at: string | null }>("SELECT last_seen_at FROM engines WHERE slug = 'builtin'")
        .catch(() => null)
      const seenMs = builtinRow?.last_seen_at
        ? Date.parse(
            String(builtinRow.last_seen_at).includes('T')
              ? String(builtinRow.last_seen_at)
              : String(builtinRow.last_seen_at).replace(' ', 'T') + 'Z',
          )
        : 0
      if (!seenMs || Date.now() - seenMs > 120_000) {
        await setFailoverOwner(db, FAILOVER_REMOTE)
        owner = FAILOVER_REMOTE
        console.log('[engine-api] 所有权残留自愈: 活跃引擎为远程代理但 owner=builtin, 且内置引擎心跳陈旧 (>120s) — 已归还代理授权 (config.active 恢复)')
        await db
          .run("INSERT INTO system_logs (level, module, message) VALUES ('INFO', 'engine', '所有权残留自愈: 内置引擎心跳陈旧, owner=builtin 已归还远程代理')")
          .catch(() => {})
      }
    }

    const active = !!engine.is_active && owner !== FAILOVER_BUILTIN
    const pollIp = enginePollIp(event)

    if (!active) {
      await db
        .run(
          "UPDATE engines SET last_seen_at = CURRENT_TIMESTAMP, last_status = 'standby', last_poll_ip = ?, last_poll_host = ? WHERE id = ?",
          [pollIp, pollHost, engine.id],
        )
        .catch(() => {})
      return ok({ active: false, accounts: [], intervals: { poll_seconds: 30 } })
    }

    const accounts = await db.all<any>(
      `SELECT c.id, c.value AS cookies, COALESCE(c.device_id, '') AS device_id
       FROM cookies c
       LEFT JOIN cookie_status cs ON cs.cookie_id = c.id
       WHERE COALESCE(cs.enabled, 1) = 1`,
    )

    await db
      .run(
        'UPDATE engines SET last_seen_at = CURRENT_TIMESTAMP, last_status = ?, last_poll_ip = ?, last_poll_host = ? WHERE id = ?',
        [`serving accounts=${accounts.length}`, pollIp, pollHost, engine.id],
      )
      .catch(() => {})

    return ok({
      active: true,
      accounts: accounts.map((a) => ({
        id: a.id,
        cookies: a.cookies,
        device_id: a.device_id || '',
      })),
      intervals: { poll_seconds: 30, heartbeat_seconds: 15 },
      server_time: Date.now(),
    })
  }),
)
