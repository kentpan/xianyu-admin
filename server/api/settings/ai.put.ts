/** PUT /api/settings/ai — update ai_model / ai_api_url / ai_api_key. */
export default defineEventHandler(
  withApi(async (event) => {
    requireAdmin(event)
    const body = await readBody(event) || {}
    const updates: { key: string; value: string }[] = []
    if (body.ai_model !== undefined) {
      updates.push({ key: 'ai_model', value: String(body.ai_model) })
    }
    if (body.ai_api_url !== undefined) {
      updates.push({ key: 'ai_api_url', value: String(body.ai_api_url) })
    }
    if (body.ai_api_key !== undefined) {
      updates.push({ key: 'ai_api_key', value: String(body.ai_api_key) })
    }
    if (body.default_reply !== undefined) {
      updates.push({ key: 'default_reply', value: String(body.default_reply) })
    }
    if (!updates.length) throw new ApiError(400, '没有需要更新的字段')

    const db = await getDb()
    for (const u of updates) {
      await setSystemSetting(u.key, u.value)
    }
    return ok({ updated: updates.map((u) => u.key) }, 'AI 设置已保存')
  }),
)
