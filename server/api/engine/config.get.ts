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
import { relayMtopRequest } from '../../utils/xianyu/gateway'
import { isManualVerifyHold } from '../../utils/xianyu/verify-state'
import { resolveChromeUA } from '../../utils/xianyu/chrome-ua'

/* ------------------- web 会话保活 (edge 部署的 admin 侧实现) -------------------
 * 闲鱼 web 登录会话是滑动过期 (~24h 无网页级活动即服务端过期, mtop token 链路滚动
 * 续不了它) — 不做网页级保活, edge 部署每 ~24h 必被踢下线要求重新扫码, 自动发货随之
 * 断链。内置引擎/代理脚本 (v2.1.17+) 各自有 webSessionKeepalive, 但 edge (CF Pages)
 * 无长驻进程, admin 侧唯一稳定节奏 = 代理的 config 轮询 (30s)。在此节奏上每账号
 * 30min 限频经透传网关 GET 闲鱼主站 (与手动「验证 cookie」同一动作): 服务端收到带
 * 会话的网页级请求即滑动续期 — 续期在请求到达时已完成, 只做续期请求, 不回写。
 * 主站回传的 Set-Cookie 绝不合并回写 (v2.1.18 事故根治): 那是主站网页上下文的
 * 反爬/追踪令牌, 与发货链不同上下文; 而网关模式下发货链全部 mtop 调用 (远程拉单
 * 兜底/发货接口) 都用库内这份 cookie 签名 — 回写会持续污染签名身份, 直接杀死
 * 自动发货 (付款三重兜底拉单失败), 且把主站对异常会话的清理指令 (空值/Max-Age=0)
 * 写进 unb 等身份字段。库内 cookie 只由同上下文的 mtop 响应轮换与扫码更新。
 * 限频用进程内 Map: CF 多隔离实例极端双触发也只是多一次无害主站访问。
 */
const WEB_KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000
const WEB_HOME_URL = 'https://www.goofish.com/'
const WEB_KEEPALIVE_TIMEOUT_MS = 8_000
const webKeepaliveLastAt = new Map<string, number>()

async function webSessionKeepaliveViaGateway(account: { id: string; cookies: string }): Promise<void> {
  const last = webKeepaliveLastAt.get(account.id) || 0
  if (Date.now() - last < WEB_KEEPALIVE_INTERVAL_MS) return
  if (isManualVerifyHold(account.id)) return // 人工验证持有期: 引擎侧静默, 不抢节奏
  webKeepaliveLastAt.set(account.id, Date.now()) // 先占位: 失败也等下个周期 (静默重试节奏与代理脚本同源)
  try {
    const res = await relayMtopRequest(WEB_HOME_URL, {
      method: 'GET',
      headers: {
        'User-Agent': resolveChromeUA().ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Cookie: String(account.cookies || ''),
      },
    })
    if (!res) {
      console.log(`[xianyu-keepalive] 账号 ${account.id} web 会话保活跳过: 透传网关未激活 (引擎行未登记 host:port)`)
      return
    }
    // 只续期不回写: 滑动续期在服务端收到请求时已完成; 回传 Set-Cookie 属于主站网页
    // 上下文, 合并回库会污染发货链 mtop 签名身份 (v2.1.18 事故根治点)
    console.log(`[xianyu-keepalive] 账号 ${account.id} web 会话保活完成 (主站 ${res.status}, 只续期不回写)`)
  } catch (e: any) {
    console.log(
      `[xianyu-keepalive] 账号 ${account.id} web 会话保活失败 (下轮重试): ${String(e?.message || e).slice(0, 140)}`,
    )
  }
}

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

    await db
      .run(
        'UPDATE engines SET last_seen_at = CURRENT_TIMESTAMP, last_status = ?, last_poll_ip = ? WHERE id = ?',
        [`serving accounts=${accounts.length}`, pollIp, engine.id],
      )
      .catch(() => {})

    // web 会话保活 (30min/账号 限频, 经透传网关; 8s 硬顶不拖慢 config 响应)
    for (const a of accounts) {
      if (!a.cookies) continue
      await Promise.race([
        webSessionKeepaliveViaGateway(a),
        new Promise((r) => setTimeout(r, WEB_KEEPALIVE_TIMEOUT_MS)),
      ])
    }

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
