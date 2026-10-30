/** POST /api/ai-configs/test — AI 配置连通性测试 (管理页「发送测试」按钮)。Body: { id, message? }。
 *  失败也返回 200: reply 为空时前端用 debug 面板呈现原始请求/响应, 不再只给一句「详见服务端日志」。 */
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
    return ok(
      { ok: result.ok, reply: result.reply, model: result.model, error: result.error, debug: result.debug },
      result.ok ? `AI 回复成功 (模型: ${result.model})` : 'AI 测试未通过, 请查看请求/响应详情',
    )
  }),
)
