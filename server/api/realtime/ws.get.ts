/**
 * GET /api/realtime/ws — 实时推送 WebSocket 端点。
 *
 * 三种运行时:
 *   workers (cloudflare-durable 预设, 自承载): WS 升级请求由 worker 入口直接转发进
 *     $DurableObject, 本 handler 的 upgrade/open/message/close 钩子在 DO isolate 内执行,
 *     连接走 Hibernation API (空闲休眠不计时长, 有消息才计费)。
 *   pages (配套模式): Pages 项目不能在自身内承载 DO 类(平台限制), 鉴权通过后把升级
 *     请求原样转发进配套 edge-realtime Worker 的 DO(REALTIME_DO 绑定, script_name);
 *     crossws 约定 upgrade 钩子返回非 ok Response 即终结握手 —— DO 回传的 101/401
 *     原样交给客户端, 浏览器始终只连站点域名(同源)。
 *   node: crossws node 适配器进程内托管, 同一套钩子 (管理后台默认仍走 SSE)。
 *
 * 协议 (server → client, 与 SSE /api/messages/stream 载荷完全同构):
 *   { type: 'ready' }                                        连接就绪
 *   { type: 'chat'|'system'|'conversation'|'sent', cookie_id, chat_id, message? }
 * 协议 (client → server): { t: <ms> } 心跳探测 → 回 { type: 'pong', t }
 */
import { REALTIME_DO_INSTANCE, REALTIME_EXTERNAL_BINDING } from '../../utils/realtime'

export default defineWebSocketHandler({
  async upgrade(request) {
    // 浏览器同源 WS 握手自动携带 cookie(admin_token); 也接受 Authorization: Bearer (脚本调试)
    const cookie = request.headers.get('cookie') || ''
    const m = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/)
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    let token = (m?.[1] || bearer || '').trim()
    try {
      token = decodeURIComponent(token)
    } catch {}
    const user = token ? verifyToken(token) : null
    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }
    // 注意: 不向 request.context 写身份 —— 全项目无消费方, 且 node 适配器的
    // NodeReqProxy 把 context 定义为只读, 任何形式的赋值(含 ??=)都会触发
    // unhandledRejection(v2.0.4 实测); 鉴权通过本身即本钩子的全部职责。
    // pages 配套模式: 转发升级请求进外部 DO hub (globalThis.__env__ 由 nitro 每次请求刷新)
    const external = (globalThis as any).__env__?.[REALTIME_EXTERNAL_BINDING]
    if (external) {
      const stub = external.get(external.idFromName(REALTIME_DO_INSTANCE))
      return stub.fetch(request)
    }
    return
  },
  open(peer) {
    peer.send(JSON.stringify({ type: 'ready' }))
  },
  message(peer, message) {
    // 实时通道是只读推送面: 不接受业务上行, 仅响应心跳
    let t = 0
    try {
      t = Number(JSON.parse(String(message))?.t || 0)
    } catch {}
    peer.send(JSON.stringify({ type: 'pong', t: t || Date.now() }))
  },
  close() {},
  error() {},
})
