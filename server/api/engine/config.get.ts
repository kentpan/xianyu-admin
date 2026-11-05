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
import { consumeRate } from '../../utils/rate-limit'
import { getFailoverOwner, FAILOVER_BUILTIN } from '../../utils/xianyu/failover'

export default defineEventHandler(
  withApi(async (event) => {
    const engine = await requireEngine(event)

    const rl = consumeRate(`engine:${engine.id}`, { capacity: 40, perMinute: 120 })
    if (!rl.ok) {
      setHeader(event, 'Retry-After', String(rl.retryAfterSeconds))
      throw new ApiError(429, `配置拉取过于频繁, 请 ${rl.retryAfterSeconds}s 后重试`)
    }

    const db = await getDb()
    const owner = await getFailoverOwner(db)
    const active = !!engine.is_active && owner !== FAILOVER_BUILTIN
    const pollIp = enginePollIp(event)

    if (!active) {
      await db
        .run(
          "UPDATE engines SET last_seen_at = CURRENT_TIMESTAMP, last_status = 'standby', last_poll_ip = ? WHERE id = ?",
          [pollIp, engine.id],
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
        'UPDATE engines SET last_seen_at = CURRENT_TIMESTAMP, last_status = ?, last_poll_ip = ? WHERE id = ?',
        [`serving accounts=${accounts.length}`, pollIp, engine.id],
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
