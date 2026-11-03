/**
 * POST /api/cards/deliver-test — 卡密发货测试 (测试生成加群验证码/卡密)。
 *
 * 与真实发货完全一致的生成链路: generateCardCode (按卡券配置的长度/英文/数字/大小写)
 * → renderCodeTemplate ({code} 渲染文案模板) → applyCardVars (启用变量替换,
 * 模拟上下文 = 发货规则绑定商品真实数据, 与 /api/cards/test-api 同源 buildCardMockVars)。
 *
 * 测试卡密同样落库 card_code_logs (source='test' 测试标签, 订单号 TEST- 前缀),
 * 可立即携 API Key 调 /api/verify-codes/verify 真实核销 — 与正常消费完全同一链路,
 * 消费记录/生成记录均带「测试」标签, 成功/失败均有详细日志。
 *
 * 不会真实发货的部分: 不发送买家消息 / 不写 card_shipments / 不改订单状态 / 不加规则发货计数。
 *
 * 请求 (登录可用): { "card_id": 1, "count": 1 }   count 1-10, 默认 1
 * 响应: { items: [{ code, text, preview, persisted }], config: {...}, note: '...' }
 */
import { persistCardCode, renderCodeTemplate } from '../../utils/card-code'
import { applyCardVars, buildCardMockVars } from '../../utils/card-api'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const body = (await readBody(event)) || {}
    const cardId = parseInt(String(body.card_id || ''), 10) || 0
    if (!cardId) throw new ApiError(400, '缺少 card_id')
    const count = Math.min(10, Math.max(1, parseInt(String(body.count || '1'), 10) || 1))

    const db = await getDb()
    const card = await db.get<any>(
      'SELECT id, name, type, code_length, code_letters, code_digits, code_case, code_template FROM cards WHERE id = ?',
      [cardId],
    )
    if (!card) throw new ApiError(404, '卡券不存在')
    if (card.type !== 'code') throw new ApiError(400, '仅卡密型 (生成型) 卡券支持发货测试')

    // 模拟上下文与真实发货渲染同源 (规则绑定商品真实数据 + 启用变量模拟值)
    const baseVars = await buildCardMockVars(db, cardId)
    const testOrderId = `TEST-${Date.now()}`
    const items: { code: string; text: string; preview: string; persisted: boolean }[] = []
    let persistedCount = 0
    for (let i = 0; i < count; i++) {
      const code = generateCardCode(card)
      // 真实发货逐份生成逐份渲染 (extractCardContent code 分支同构): {code} 回填后其余变量照常替换
      const text = applyCardVars(renderCodeTemplate(card.code_template, code), { ...baseVars, code })
      // 测试卡密落库 (source='test'): 与真实卡密同表同链路, 可被消费 API 真实核销
      const saved = await persistCardCode(
        db,
        card,
        { cookieId: '发货测试', itemId: String(baseVars.item_id || ''), orderId: testOrderId, buyerId: '测试买家' },
        code,
        'test',
      )
      if (saved) persistedCount++
      const finalCode = saved || code
      // 唯一冲突重新生成时 (saved ≠ 首次 code), 用最终生效卡密重渲染文案, 保证 code 与文案一致
      const finalText = saved === code ? text : applyCardVars(renderCodeTemplate(card.code_template, finalCode), { ...baseVars, code: finalCode })
      items.push({ code: finalCode, text: finalText, preview: `[卡密] ${finalCode}`, persisted: !!saved })
    }

    return ok({
      card_id: card.id,
      card_name: card.name,
      count,
      order_id: testOrderId,
      persisted_count: persistedCount,
      items,
      config: {
        length: Number(card.code_length ?? 6) || 6,
        letters: Number(card.code_letters ?? 1) === 1,
        digits: Number(card.code_digits ?? 1) === 1,
        case: String(card.code_case || 'mixed'),
        template: String(card.code_template || '') || '(默认文案)',
      },
      note: '测试生成: 与真实发货同一生成链路并已入库 (带「测试」标签), 可用消费 API 真实核销验证; 不发送买家消息 / 不写发货记录 / 不改订单状态',
    })
  }),
)
