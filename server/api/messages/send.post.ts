/** POST /api/messages/send — 后台手动发送文本消息 (内置引擎在线账号, 同步落库 + SSE 推送)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}
    const cookieId = (body.cookie_id || '').toString().trim()
    const chatId = (body.chat_id || '').toString().trim()
    const text = (body.text || '').toString().trim()
    if (!cookieId || !chatId) throw new ApiError(400, '缺少 cookie_id 或 chat_id')
    if (!text) throw new ApiError(400, '消息内容不能为空')
    if (text.length > 500) throw new ApiError(400, '消息过长 (上限 500 字)')

    // 收件人 = 会话对方 (out 消息按会话归属发送)
    const conv = await db.get<any>('SELECT peer_user_id FROM im_conversations WHERE cookie_id = ? AND chat_id = ?', [cookieId, chatId])
    const toUserId = (conv?.peer_user_id || '').toString().split('@')[0]
    if (!toUserId) throw new ApiError(400, '会话缺少对方用户 ID, 无法发送')

    const { sendTextToAccount } = await import('../../utils/xianyu/engine-manager')
    try {
      await sendTextToAccount(cookieId, chatId, toUserId, text)
    } catch (e: any) {
      throw new ApiError(409, e?.message || '发送失败 (账号不在线或引擎未托管)')
    }
    return ok({ sent: true }, '已发送')
  }),
)
