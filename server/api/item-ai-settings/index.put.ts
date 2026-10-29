/** PUT /api/item-ai-settings — upsert 商品级 AI 配置 (模型接入改为引用 AI 配置中心)。 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}
    const cookieId = (body.cookie_id || '').toString().trim()
    const itemId = (body.item_id || '').toString().trim()
    if (!cookieId || !itemId) throw new ApiError(400, '缺少 cookie_id 或 item_id')

    const existing = await db.get<any>('SELECT id FROM item_ai_settings WHERE cookie_id = ? AND item_id = ?', [cookieId, itemId])

    const ai_enabled = body.ai_enabled ? 1 : 0
    const ai_config_id = Math.max(0, Math.round(Number(body.ai_config_id) || 0))

    if (ai_config_id > 0) {
      const cfg = await db.get<any>('SELECT id, name, enabled FROM ai_configs WHERE id = ?', [ai_config_id])
      if (!cfg) throw new ApiError(400, '所选 AI 配置不存在, 请重新选择')
      if (!Number(cfg.enabled)) throw new ApiError(400, `AI 配置「${cfg.name}」已停用, 请先在 AI 配置页启用或改选其他配置`)
    }

    const clampInt = (v: any, min: number, max: number, dft: number) => {
      const n = Math.round(Number(v))
      if (!Number.isFinite(n)) return dft
      return Math.min(max, Math.max(min, n))
    }
    const max_discount_percent = clampInt(body.max_discount_percent, 0, 100, 10)
    const max_discount_amount = clampInt(body.max_discount_amount, 0, 1000000, 100)
    const max_bargain_rounds = clampInt(body.max_bargain_rounds, 0, 100, 3)
    const custom_prompts = (body.custom_prompts ?? '').toString()

    if (ai_enabled && ai_config_id === 0) {
      throw new ApiError(400, '开启该商品 AI 回复前请选择 AI 配置 (可先到「AI配置」页新建)')
    }

    // 模型接入唯一来源为 AI 配置中心, 行内遗留字段不再维护 (清空)
    if (existing) {
      await db.run(
        `UPDATE item_ai_settings SET
           ai_enabled = ?, ai_config_id = ?, model_name = '', api_key = '', base_url = '',
           max_discount_percent = ?, max_discount_amount = ?, max_bargain_rounds = ?,
           custom_prompts = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [ai_enabled, ai_config_id, max_discount_percent, max_discount_amount, max_bargain_rounds, custom_prompts, existing.id],
      )
    } else {
      await db.run(
        `INSERT INTO item_ai_settings (
           cookie_id, item_id, ai_enabled, ai_config_id, model_name, api_key, base_url,
           max_discount_percent, max_discount_amount, max_bargain_rounds, custom_prompts
         ) VALUES (?, ?, ?, ?, '', '', '', ?, ?, ?, ?)`,
        [cookieId, itemId, ai_enabled, ai_config_id, max_discount_percent, max_discount_amount, max_bargain_rounds, custom_prompts],
      )
    }

    return ok({ cookie_id: cookieId, item_id: itemId, ai_enabled, ai_config_id }, '商品 AI 配置已保存')
  }),
)
