/** GET /api/item-ai-settings?cookie_id=&item_id= — 商品级 AI 配置 (api_key 出参掩码, 附引用的配置中心条目摘要)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const cookieId = (q.cookie_id || '').toString().trim()
    const itemId = (q.item_id || '').toString().trim()
    if (!cookieId || !itemId) throw new ApiError(400, '缺少 cookie_id 或 item_id')

    const row = await db.get<any>(
      'SELECT * FROM item_ai_settings WHERE cookie_id = ? AND item_id = ?',
      [cookieId, itemId],
    )
    if (!row) {
      return ok({
        cookie_id: cookieId, item_id: itemId, ai_enabled: 0, ai_config_id: 0,
        model_name: 'qwen-plus', api_key: '', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        max_discount_percent: 10, max_discount_amount: 100, max_bargain_rounds: 3,
        custom_prompts: '', api_key_masked: false, ai_config: null,
      })
    }

    let aiConfig: any = null
    if (Number(row.ai_config_id) > 0) {
      aiConfig = await db.get<any>(
        'SELECT id, name, model_name, base_url, enabled FROM ai_configs WHERE id = ?',
        [row.ai_config_id],
      )
    }
    return ok({ ...row, api_key: '', api_key_masked: !!row.api_key, ai_config: aiConfig })
  }),
)
