/** POST /api/ai-configs/test — AI 配置连通性测试 (管理页「发送测试」按钮)。Body: { id, message? } */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = await readBody(event)
    const id = Number(body?.id)
    if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, '请选择 AI 配置')
    const db = await getDb()

    const conf = await db.get<any>(
      'SELECT id, name, model_name, api_key, base_url, enabled FROM ai_configs WHERE id = ?',
      [id],
    )
    if (!conf) throw new ApiError(404, 'AI 配置不存在')
    if (!Number(conf.enabled)) throw new ApiError(400, '该配置已停用, 请先在 AI 配置中启用')

    // probeAiConfig is auto-imported by Nitro from server/utils/xianyu/brain.ts
    const result = await probeAiConfig(
      { base_url: conf.base_url, model_name: conf.model_name, api_key: conf.api_key },
      String(body?.message || ''),
    )
    if (!result.ok) throw new ApiError(400, result.error || 'AI 测试失败')
    return ok({ reply: result.reply, model: result.model }, `AI 回复成功 (模型: ${result.model})`)
  }),
)
