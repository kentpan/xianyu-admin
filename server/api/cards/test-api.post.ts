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
    // 测试时用模拟上下文替换变量 ({title}/{price}/{apikey} 等), 与真实发货请求一致
    const c = conf as Record<string, unknown>
    const result = await fetchApiCardContent(conf, {
      title: '测试商品',
      price: '9.9',
      apikey: String(c?.api_key || ''),
      username: '测试买家',
      userid: 'test_buyer_id',
    })
    return ok({
      ok: result.ok,
      status: result.status,
      text: result.text.slice(0, 500),
      message: result.message,
    })
  }),
)
