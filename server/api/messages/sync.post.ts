/** POST /api/messages/sync — 从闲鱼平台拉取会话列表 (WS 真实协议 listNewestPagination, 非轮询, 手动触发)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = await readBody(event).catch(() => ({}))
    const cookieId = (body.cookie_id || '').toString().trim()
    const limit = Math.min(50, Math.max(1, Number(body.limit || 30)))

    const { getAccountClient } = await import('../../utils/xianyu/engine-manager')
    const { persistPlatformConversations } = await import('../../utils/xianyu/im-store')
    const client = getAccountClient(cookieId)
    if (!client) throw new ApiError(409, `账号 ${cookieId} 不由内置引擎托管`)
    if (!client.isOnline()) throw new ApiError(409, '账号连接未就绪, 稍后再试')

    const payload = await client.fetchConversationList(0, limit)
    const stored = await persistPlatformConversations(cookieId, payload)
    const fetched = Array.isArray(payload?.userConvs) ? payload.userConvs.length : 0
    return ok({ fetched, stored }, `拉取 ${fetched} 个会话, 落库 ${stored} 条`)
  }),
)
