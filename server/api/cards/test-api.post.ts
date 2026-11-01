/** POST /api/cards/test-api — API 卡券配置测试: 服务端代发一次请求并按 data_path 提取 (浏览器直连外部接口有 CORS 限制)。 */
import { buildCardMockVars } from '../../utils/card-api'

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
    // 测试时用模拟上下文替换变量, 浏览器直连外部接口有 CORS 限制。
    // 模拟值 = 这张卡真实会发货的商品数据 (buildCardMockVars: 规则绑定商品 → 回落最新同步商品 + 启用变量模拟值)。
    const c = conf as Record<string, unknown>
    const db = await getDb()
    const cardId = parseInt(String((body as any).card_id || ''), 10) || 0
    const mockVars = await buildCardMockVars(db, cardId)
    mockVars.apikey = String(c?.api_key || '')
    const result = await fetchApiCardContent(conf, mockVars)
    return ok({
      ok: result.ok,
      status: result.status,
      text: result.text.slice(0, 500),
      message: result.message,
    })
  }),
)
