/**
 * xianyu/gateway — 独立代理「POST 透传网关」客户端 (后台 CF Pages → 代理网关 → 闲鱼 mtop)。
 *
 * 背景: Cloudflare Pages 出口到闲鱼 mtop 网关 (h5api.m.goofish.com) 直连被墙/超时
 * (获取订单等接口必 500)。代理脚本 (scripts/xianyu-proxy.mjs) 部署在可达闲鱼的机器上
 * (「监听服务」页引擎行登记了公网 IP + 端口, 如 47.76.132.145:8880), 开启 POST /gateway
 * 透传网关后, 后台把完整 mtop 请求 (URL + 请求头 + 请求体, sign/_m_h5_tk 等业务逻辑
 * 全部在后台 mtop.ts 完成) 原样 POST 给网关, 由代理本机转发并原样返回响应 — 代理零业务逻辑。
 *
 * 与 H5 扫码登录同一条可达性思路: CF 连不上闲鱼, 就让"连得上闲鱼的机器"替它发。
 *
 * 寻址: 引擎行登记的 host:port (listener 页「IP 地址 / 域名 + 端口」)。★ 不填公网 IP
 * 后台根本连不到网关 — 透传依赖该登记; 任务模式 (未登记) 自动回落任务通道 (order-task.ts)。
 *
 * 鉴权: Bearer <engines.token> — 引擎行的接入令牌, 与代理 .env 的 XY_ENGINE_TOKEN 同值
 * (网关鉴权复用引擎接入令牌, 无独立变量)。网关侧另有目标域名白名单 (仅闲鱼/淘系)。
 *
 * 兜底链: 网关透传 (登记了 host:port, 秒级直返) → 任务通道 (代理 3s 轮询 engine_tasks,
 * 主动外呼无需公网入站) → 本机直连 (内置引擎/本地 dev 原语义)。
 */
import { getDb } from '../db'

/** 透传网关寻址信息 (引擎行登记)。 */
export interface GatewayTarget {
  baseUrl: string
  token: string
}

/** 网关透传结果 (与直连 fetch 同构: 状态码 + 响应文本 + Set-Cookie 列表)。 */
export interface GatewayRelayResult {
  status: number
  text: string
  setCookie: string[]
}

/** 目标解析缓存 (15s): 引擎行 host/port/token 变更最迟 15s 生效; mtop 高频调用不逐次查库。 */
let targetCache: { at: number; target: GatewayTarget | null } | null = null
const TARGET_TTL_MS = 15_000

/**
 * 解析当前生效引擎的透传网关地址: is_active 且登记了 host:port:token 才算配置完整。
 * host 支持公网 IP 或域名 (容错剥掉误填的 scheme / 尾斜杠)。
 */
export async function resolveGatewayTarget(db: Awaited<ReturnType<typeof getDb>>): Promise<GatewayTarget | null> {
  try {
    const row = await db
      .get<{ host: string; port: number; token: string }>(
        `SELECT host, port, token FROM engines
         WHERE is_active = 1 AND enabled = 1 AND host IS NOT NULL AND host != '' AND port IS NOT NULL AND port > 0
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .catch(() => null)
    if (!row) return null
    const host = String(row.host || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    const port = Math.round(Number(row.port) || 0)
    const token = String(row.token || '').trim()
    if (!host || !port || !token) return null
    return { baseUrl: `http://${host}:${port}`, token }
  } catch {
    return null
  }
}

/** 网关模式判定 (调用方分流用): true = 当前生效引擎登记了可直连的透传网关地址。 */
export async function isGatewayMode(db: Awaited<ReturnType<typeof getDb>>): Promise<boolean> {
  return !!(await resolveGatewayTarget(db))
}

async function cachedTarget(): Promise<GatewayTarget | null> {
  if (targetCache && Date.now() - targetCache.at < TARGET_TTL_MS) return targetCache.target
  const db = await getDb()
  const target = await resolveGatewayTarget(db)
  targetCache = { at: Date.now(), target }
  return target
}

/** 网关单请求硬超时: 上游 mtop 20s + 传输余量, 上限压在 CF 请求预算内。 */
const GATEWAY_TIMEOUT_MS = 26_000

/**
 * mtop 传输层钩子 (供 mtop.ts 调用):
 *  - 网关未激活 (未登记 host:port / 库不可用) → 返回 null, 调用方本机直连 (原语义);
 *  - 网关激活 → 请求原样 POST 给代理网关, 成功返回与直连同构的结果;
 *  - 网关激活但失败 (不可达/鉴权/转发错误) → 抛错, 调用方捕获后走任务通道兜底。
 */
export async function relayMtopRequest(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<GatewayRelayResult | null> {
  let target: GatewayTarget | null = null
  try {
    target = await cachedTarget()
  } catch {
    return null // 库不可用 (极端场景): 视为网关未激活, 直连原语义
  }
  if (!target) return null

  let res: Response
  try {
    res = await fetch(`${target.baseUrl}/gateway`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body || '',
        timeout_ms: 22_000,
      }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    })
  } catch (e: any) {
    throw new Error(`透传网关不可达 (${target.baseUrl}): ${String(e?.message || e).slice(0, 140)}`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`透传网关鉴权失败 (${res.status}): 「监听服务」页引擎接入令牌须与代理 .env 的 XY_ENGINE_TOKEN 一致`)
  }
  if (!res.ok) {
    throw new Error(`透传网关响应异常 ${res.status}`)
  }
  const payload: any = await res.json().catch(() => null)
  if (!payload?.ok) {
    throw new Error(`透传网关转发失败: ${String(payload?.error || '未知错误').slice(0, 180)}`)
  }
  return {
    status: Number(payload.status) || 0,
    text: String(payload.text || ''),
    setCookie: Array.isArray(payload.set_cookie) ? payload.set_cookie.map(String) : [],
  }
}
