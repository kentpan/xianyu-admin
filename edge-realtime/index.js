/**
 * edge-realtime — xianyu-admin 配套实时 Worker(Cloudflare Durable Objects hub)。
 *
 * 为什么需要本 Worker: Pages 项目不能在自身内创建/部署 DO 类(Cloudflare 平台限制,
 * 官方文档: "You cannot create and deploy a Durable Object within a Pages project"),
 * DO 必须由独立 Worker 承载。本 Worker 独立部署后, 站点(Pages/Workers 形态均可)通过
 * REALTIME_DO 绑定(wrangler.toml durable_objects.bindings + script_name)直呼本 DO:
 *   - WS 升级: 站点 /api/realtime/ws 鉴权通过后把升级请求原样转发进 DO(idFromName('server'))
 *   - 事件广播: 站点 publishToHub POST /api/realtime/publish → DO getWebSockets() 逐连接 send
 * 本 Worker 自身亦暴露同协议路由(直连 workers.dev 调试用), 与站点共用 XY_JWT_SECRET 鉴权。
 *
 * 部署: npx wrangler deploy -c edge-realtime/wrangler.toml
 * 密钥: printf '%s' "$JWT_SECRET" | npx wrangler secret put XY_JWT_SECRET -c edge-realtime/wrangler.toml
 */
import { DurableObject } from 'cloudflare:workers'

// ⚠ Worker 入口只允许导出 DO 类与 default handler —— 常量一律模块内私有,
// 否则 workerd 启动即报 "Incorrect type for map entry 'DO_CLASS'"。
const DO_CLASS = 'EdgeRealtimeDO'
const DO_INSTANCE = 'server'
const PUBLISH_PATH = '/api/realtime/publish'

/** base64url → bytes(JWT 三段解码用)。 */
function b64urlToBytes(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/**
 * HS256 JWT 校验(WebCrypto, 零依赖) — 与站点侧 server/utils/auth.ts 的 signToken(HS256, 7d)完全兼容。
 */
async function verifyJwt(token, secret) {
  if (!token || !secret) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [h, p, sig] = parts
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)))
    if (header.alg !== 'HS256') return null
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`),
    )
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)))
    if (payload.exp && Date.now() / 1000 >= payload.exp) return null
    return payload
  } catch {
    return null
  }
}

/** 提取令牌: Authorization: Bearer 优先, 同源握手回落 admin_token cookie(与站点 ws.get.ts 同口径)。 */
function extractToken(request) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (bearer.trim()) return bearer.trim()
  const cookie = request.headers.get('cookie') || ''
  return (cookie.match(/(?:^|;\s*)admin_token=([^;]+)/) || [])[1] || ''
}

async function authenticate(request, env) {
  let token = extractToken(request)
  try {
    token = decodeURIComponent(token)
  } catch {}
  return verifyJwt(token, env.XY_JWT_SECRET)
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const ok = (data) => ({ success: true, msg: 'ok', data })
const fail = (msg) => ({ success: false, msg })

/**
 * DO hub 单例(idFromName('server')) — WebSocket Hibernation API:
 * 空闲连接休眠不计时长, 广播/心跳唤醒才计费。协议与站点 ws.get.ts 完全同构:
 *   连接建立 → { type: 'ready' }; 上行 { t: <ms> } → 回 { type: 'pong', t }。
 */
export class EdgeRealtimeDO extends DurableObject {
  async fetch(request) {
    if (request.headers.get('upgrade') === 'websocket') {
      const user = await authenticate(request, this.env)
      if (!user) return json(fail('未授权或登录已过期'), 401)
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1])
      try {
        pair[1].send(JSON.stringify({ type: 'ready' }))
      } catch {}
      return new Response(null, { status: 101, webSocket: pair[0] })
    }
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === PUBLISH_PATH) {
      let body = null
      try {
        body = await request.json()
      } catch {}
      if (!body || typeof body !== 'object') return json(ok({ relayed: false }))
      const packet = JSON.stringify(body)
      let clients = 0
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(packet)
          clients++
        } catch {}
      }
      return json(ok({ relayed: true, clients }))
    }
    return json(fail('Not Found'), 404)
  }

  async webSocketMessage(client, message) {
    let t = 0
    try {
      t = Number(JSON.parse(String(message))?.t || 0)
    } catch {}
    try {
      client.send(JSON.stringify({ type: 'pong', t: t || Date.now() }))
    } catch {}
  }

  async webSocketClose() {}

  async webSocketError() {}
}

/** Worker 入口: 站点/浏览器直连面 — /ws 升级、/publish 广播(secret 保护)、/health 探针。 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const namespace = env.REALTIME_HUB
    if (!namespace) {
      return json(fail('REALTIME_HUB binding missing(edge-realtime/wrangler.toml)'), 500)
    }
    const stub = namespace.get(namespace.idFromName(DO_INSTANCE))
    if (request.headers.get('upgrade') === 'websocket') {
      const user = await authenticate(request, env)
      if (!user) return json(fail('未授权或登录已过期'), 401)
      return stub.fetch(request)
    }
    if (request.method === 'POST' && (url.pathname === '/publish' || url.pathname === PUBLISH_PATH)) {
      if (!env.XY_JWT_SECRET || request.headers.get('x-pub-secret') !== env.XY_JWT_SECRET) {
        return json(fail('forbidden'), 403)
      }
      return stub.fetch(new Request('https://realtime.hub' + PUBLISH_PATH, request))
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      return json(ok({ type: 'edge-realtime-hub', do: DO_CLASS, instance: DO_INSTANCE }))
    }
    return json(fail('Not Found'), 404)
  },
}
