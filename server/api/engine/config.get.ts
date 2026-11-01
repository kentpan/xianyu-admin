/**
 * GET /api/engine/config — 远程代理拉取监听配置 (轮询, 默认 30s)。
 *
 * 鉴权: 标准 `Authorization: Bearer <token>`。
 * 只有「使用中」(is_active=1) 且启用的代理能拿到账号; 非活动代理收到 active=false
 * → 代理自动下线全部连接 (多引擎互斥, 防重复回复/风控雪崩)。
 *
 * 下发内容 = 纯连接所需: 账号 Cookie + 持久化设备指纹 + 轮询间隔。
 * 不下发任何业务规则/卡券/订单 — 业务状态只存在于本后台。
 */
import { consumeRate } from '../../utils/rate-limit'

export default defineEventHandler(
  withApi(async (event) => {
    const engine = await requireEngine(event)

    const rl = consumeRate(`engine:${engine.id}`, { capacity: 40, perMinute: 120 })
    if (!rl.ok) {
      setHeader(event, 'Retry-After', String(rl.retryAfterSeconds))
      throw new ApiError(429, `配置拉取过于频繁, 请 ${rl.retryAfterSeconds}s 后重试`)
    }

    const db = await getDb()
    const active = !!engine.is_active
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

    // 订单自动同步节奏 (v2.1.12): 后台系统设置为准 (order_sync_enabled/order_sync_interval),
    // 下发给代理定时触发 POST /api/engine/orders-sync (CF 无长驻进程, 代理是唯一长驻点)
    const syncSettings = await db
      .all<{ key_name: string; value: string }>(
        "SELECT key_name, value FROM system_settings WHERE key_name IN ('order_sync_enabled', 'order_sync_interval')",
      )
      .catch(() => [] as { key_name: string; value: string }[])
    const settingMap = new Map(syncSettings.map((r) => [r.key_name, r.value]))
    const orderSyncEnabled = String(settingMap.get('order_sync_enabled') ?? 'true') !== 'false'
    const orderSyncSeconds = Math.min(
      Math.max(Math.round(Number(settingMap.get('order_sync_interval') || 1800)) || 1800, 600),
      7200,
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
      intervals: {
        poll_seconds: 30,
        heartbeat_seconds: 15,
        order_sync_enabled: orderSyncEnabled,
        order_sync_seconds: orderSyncSeconds,
      },
      server_time: Date.now(),
    })
  }),
)
