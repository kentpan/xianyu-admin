/**
 * POST /api/realtime/publish — DO hub 内部广播面 (publishToHub 专用, 无鉴权但不外泄)。
 *
 * 只有经 DO 绑定 stub.fetch 进入的请求才带 `cloudflare.durable` 上下文 (nitro
 * cloudflare-durable 预设约定), 此时本 handler 运行在 DO isolate 内、能拿到全部
 * hibernation WebSocket 连接; 外部/普通请求路径上该上下文不存在 → 空操作。
 */
export default defineEventHandler(async (event) => {
  const cf: any =
    (event.context as any)?._platform?.cloudflare || (event.context as any)?.cloudflare || {}
  if (!cf.durable) {
    return ok({ relayed: false })
  }
  const body = await readBody(event)
  if (!body || typeof body !== 'object') {
    return ok({ relayed: false })
  }
  const packet = JSON.stringify(body)
  let clients = 0
  for (const ws of cf.durable.ctx.getWebSockets()) {
    try {
      ws.send(packet)
      clients++
    } catch {}
  }
  return ok({ relayed: true, clients })
})
