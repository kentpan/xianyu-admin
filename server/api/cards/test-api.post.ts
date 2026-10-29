/** POST /api/cards/test-api — API 卡券配置测试: 服务端代发一次请求并按 data_path 提取 (浏览器直连外部接口有 CORS 限制)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = (await readBody(event)) || {}
    const raw = typeof body.api_config === 'string' ? body.api_config : JSON.stringify(body.api_config ?? {})
    let conf: unknown
    try {
      conf = JSON.parse(raw || '{}')
    } catch {
      throw new ApiError(400, 'API 配置不是合法 JSON')
    }
    const result = await fetchApiCardContent(conf)
    return ok({
      ok: result.ok,
      status: result.status,
      text: result.text.slice(0, 500),
      message: result.message,
    })
  }),
)
