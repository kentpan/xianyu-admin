/**
 * PROXY_MODE 代理透传中间件 (v2.3.12) — 代理透传站点在 Nuxt 形态的服务端实现层。
 *
 * 根因背景 (功能缺口根修, 非兜底): 部署工作流的代理透传契约 (PROXY_MODE 开启 →
 * 跳过 D1/KV 创建与绑定, /api/* 整体透传) 此前只有 Next.js 适配层实现了消费,
 * Nuxt 形态无任何消费方 —— Pages 上 /api/* 仍由本地处理器执行, 触碰设计上不存在的
 * 本地数据库, 全部 500 报 "D1 binding \"DB\" not found in Cloudflare env"。
 * 本中间件从源头补齐:
 *   - /api/* 全部请求原样转发上游 (method/query/headers/body 逐字保真; 响应含
 *     Set-Cookie/重定向/流式 body 原样回传), 本地数据库零触碰 —— 透传模式下 D1
 *     绑定被工作流刻意跳过, 任何本地 DB 访问都是设计外路径;
 *   - WebSocket 升级请求无法经 HTTP fetch 透传 (协议限制), 交给本地 realtime
 *     处理器 (其鉴权走 JWT cookie/密钥, 不触数据库);
 *   - Nitro 构建期预渲染不透传 (构建产物绝不能依赖上游可达性);
 *   - 上游不可达 → 502 大声报错, 绝不回落本地处理; 配置非法 → 500 大声报错。
 */
import { proxyModeState } from '../utils/proxy-mode'

/**
 * 请求方向逐跳头 (host/content-length 由 fetch 重算; accept-encoding 剥离后由上游
 * 按自身能力压缩, 响应侧同步剥离编码头, 防止已解码 body 与残留编码头不符)。
 */
const REQ_SKIP_HEADERS = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding'])
/** 响应方向逐跳头 + 传输编码头 (fetch 已自动解码 body, 编码/长度头不得原样透传)。 */
const RES_SKIP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding'])

export default defineEventHandler(async (event) => {
  // event 必传 (v2.3.13): 请求上下文是 workerd 上 Pages env vars 的可靠真源
  // (process.env 桥接在兼容日期不受控时不可靠, 线上实锤), 见 proxy-mode.ts
  const state = proxyModeState(event)
  if (state.kind === 'off') return

  const path = event.path || ''
  if (!path.startsWith('/api/')) return

  // WebSocket 升级: fetch 无法透传 upgrade 握手, 交本地处理器 (不触数据库)
  if ((getHeader(event, 'upgrade') || '').toLowerCase() === 'websocket') return

  // Nitro 构建期预渲染不透传: 构建产物绝不能依赖上游可达性
  if ((import.meta as any).prerender === true) return

  if (state.kind === 'invalid') {
    console.error(`[proxy-passthrough] PROXY_MODE 配置无效: ${state.reason} (值已脱敏, 长度 ${state.raw.length})`)
    setResponseStatus(event, 500)
    return { success: false, code: 500, message: `PROXY_MODE 配置无效: ${state.reason} (应为 <apiKey>@http(s)://上游地址)` }
  }

  // 自指防护: 上游指回站点自身 = 无限转发环路, 直接大声拒绝
  if (getRequestURL(event).origin === state.upstreamOrigin) {
    console.error('[proxy-passthrough] PROXY_MODE 上游指向站点自身, 拒绝转发 (自指环路防护)')
    setResponseStatus(event, 500)
    return { success: false, code: 500, message: 'PROXY_MODE 上游地址指向站点自身, 已拒绝转发 (自指环路防护)' }
  }

  const target = state.upstream.replace(/\/+$/, '') + path
  const method = getMethod(event)

  const fwdHeaders = new Headers()
  for (const [k, v] of Object.entries(getRequestHeaders(event))) {
    if (REQ_SKIP_HEADERS.has(k.toLowerCase())) continue
    if (Array.isArray(v)) for (const item of v) fwdHeaders.append(k, item)
    else if (v != null && v !== '') fwdHeaders.append(k, v)
  }

  // 与 readRawBody 的方法断言集合严格一致 (GET/HEAD/OPTIONS 无请求体, 直接转发)
  const needsBody = ['PATCH', 'POST', 'PUT', 'DELETE'].includes(method)
  let body: Buffer | undefined
  if (needsBody) body = (await readRawBody(event, false)) ?? undefined

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(target, { method, headers: fwdHeaders, body, redirect: 'manual' })
  } catch (e: any) {
    console.error(`[proxy-passthrough] 上游请求失败: ${method} ${path} → ${state.upstreamOrigin} — ${e?.message || e}`)
    setResponseStatus(event, 502)
    return { success: false, code: 502, message: `代理上游不可达 (${state.upstreamOrigin}): ${e?.message || e}` }
  }

  const resHeaders = new Headers()
  upstreamRes.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (RES_SKIP_HEADERS.has(k) || k === 'set-cookie') return
    resHeaders.append(key, value)
  })
  // 多重 Set-Cookie 必须逐条 append (Headers.set 会折叠同名头, 登录链路会丢 Cookie)
  for (const cookie of upstreamRes.headers.getSetCookie()) resHeaders.append('set-cookie', cookie)

  console.log(`[proxy-passthrough] ${method} ${path} → ${upstreamRes.status} (${state.upstreamOrigin})`)
  return new Response(upstreamRes.body, { status: upstreamRes.status, statusText: upstreamRes.statusText, headers: resHeaders })
})
