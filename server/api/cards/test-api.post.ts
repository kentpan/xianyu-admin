/** POST /api/cards/test-api — API 卡券配置测试: 服务端代发一次请求并按 data_path 提取 (浏览器直连外部接口有 CORS 限制)。 */
import type { ApiCardVars } from '../../utils/card-api'

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
    // 模拟值 = 这张卡真实会发货的商品数据: 编辑已有卡券时取其发货规则绑定的商品 (item_id/title/price),
    // 资源交付平台按 item_id 匹配绑定资源, 用真实商品ID测试才能命中; 新卡券回落最新同步商品。
    const c = conf as Record<string, unknown>
    const db = await getDb()
    const cardId = parseInt(String((body as any).card_id || ''), 10) || 0
    let item: { item_id: string; item_title: string; item_price: string } | null = null
    if (cardId) {
      const rule = await db
        .get<{ item_id: string }>(
          "SELECT item_id FROM delivery_rules WHERE card_id = ? AND item_id != '' ORDER BY id DESC LIMIT 1",
          [cardId],
        )
        .catch(() => null)
      if (rule?.item_id) {
        item = await db
          .get<{ item_id: string; item_title: string; item_price: string }>(
            'SELECT item_id, item_title, item_price FROM item_info WHERE item_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1',
            [rule.item_id],
          )
          .catch(() => null)
      }
    }
    if (!item) {
      item = await db
        .get<{ item_id: string; item_title: string; item_price: string }>(
          'SELECT item_id, item_title, item_price FROM item_info ORDER BY updated_at DESC, rowid DESC LIMIT 1',
        )
        .catch(() => null)
    }
    const enabledVars = await db
      .all<{ var_key: string; category: string; sample_value: string }>(
        "SELECT var_key, category, sample_value FROM card_variables WHERE enabled = 1 AND var_key != 'shareURL'",
      )
      .catch(() => [] as { var_key: string; category: string; sample_value: string }[])
    const mockVars: ApiCardVars = {
      title: String(item?.item_title || '测试商品'),
      price: String(item?.item_price || '9.9'),
      item_id: String(item?.item_id || 'test_item_id'),
      apikey: String(c?.api_key || ''),
      username: '测试买家',
      userid: 'test_buyer_id',
    }
    for (const v of enabledVars) {
      const key = String(v.var_key || '')
      if (!key || key in mockVars) continue
      if (v.category === 'item') {
        mockVars[key] = key === 'item_id' ? 'test_item_id' : key === 'quantity' ? '1' : `测试商品${key === 'desc' ? '描述' : key === 'detail' ? '详情' : key}`
      } else if (v.category === 'account') {
        mockVars[key] = key === 'seller_nick' ? '测试卖家' : key === 'seller_id' ? 'test_seller_id' : key === 'username' ? '测试买家' : 'test_buyer_id'
      } else if (v.category === 'code') {
        mockVars[key] = key === 'code' ? 'aB3x9K' : key === 'card_name' ? '测试卡券' : key === 'card_id' ? '1' : 'test_order_id'
      } else if (v.category === 'custom') {
        mockVars[key] = String(v.sample_value || '')
      }
    }
    const result = await fetchApiCardContent(conf, mockVars)
    return ok({
      ok: result.ok,
      status: result.status,
      text: result.text.slice(0, 500),
      message: result.message,
    })
  }),
)
