/** GET /api/messages/stream — 消息管理实时推送 SSE (引擎入站/出站/会话事件直推, 禁轮询)。 */
export default defineEventHandler(async (event) => {
  requireUser(event)

  const stream = createEventStream(event)
  const { onImEvent } = await import('../../utils/xianyu/im-store')

  const off = onImEvent((e) => {
    const payload =
      e.type === 'conversation'
        ? { type: 'conversation', cookie_id: e.cookieId, chat_id: e.chatId }
        : { type: e.type, cookie_id: e.cookieId, chat_id: e.chatId, message: e.message }
    void stream.push(JSON.stringify(payload)).catch(() => {})
  })

  const hb = setInterval(() => {
    void stream.push(JSON.stringify({ hb: Date.now() })).catch(() => {})
  }, 25_000)

  stream.onClosed(async () => {
    clearInterval(hb)
    off()
  })

  await stream.send()
})
