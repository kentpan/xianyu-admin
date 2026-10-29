/**
 * POST /api/ai-settings/test — AI 回复配置连通性测试 (语义对齐 butler POST /ai-reply-test/{cookie_id})。
 * Body: { cookie_id, message?, item_title?, item_price?, item_desc? }
 * 使用与引擎 brain.testAiReply 完全相同的配置读取与提示词组装, 不落库会话。
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const body = await readBody(event)
    const cookieId = String(body?.cookie_id || '').trim()
    if (!cookieId) throw new ApiError(400, '请选择账号')
    const db = await getDb()

    const cookie = await db.get<{ id: string; user_id: number }>('SELECT id, user_id FROM cookies WHERE id = ?', [cookieId])
    if (!cookie) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && cookie.user_id !== payload.userId) {
      throw new ApiError(403, '无权操作此账号')
    }

    // testAiReply is auto-imported by Nitro from server/utils/xianyu/brain.ts
    const result = await testAiReply(cookieId, String(body?.message || ''), {
      item_title: body?.item_title ? String(body.item_title) : undefined,
      item_price: body?.item_price ? String(body.item_price) : undefined,
      item_desc: body?.item_desc ? String(body.item_desc) : undefined,
    })

    if (!result.ok) throw new ApiError(400, result.error || 'AI 测试失败')
    return ok({ reply: result.reply, model: result.model }, `AI 回复成功 (模型: ${result.model})`)
  }),
)
