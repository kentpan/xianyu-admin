/** PUT /api/ai-settings/:cookieId — upsert AI reply settings for one account. */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    if (!cookieId) throw new ApiError(400, '无效的账号 ID')
    const db = await getDb()

    const cookie = await db.get<{ id: string; user_id: number }>('SELECT id, user_id FROM cookies WHERE id = ?', [cookieId])
    if (!cookie) throw new ApiError(404, '账号不存在')
    if (!payload.isAdmin && cookie.user_id !== payload.userId) {
      throw new ApiError(403, '无权访问此账号')
    }

    const body = await readBody(event) || {}

    const existing = await db.get('SELECT cookie_id FROM ai_reply_settings WHERE cookie_id = ?', [cookieId])
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
      throw new ApiError(400, '开启 AI 回复前请选择 AI 配置 (可先到「AI配置」页新建)')
    }

    // 模型接入唯一来源为 AI 配置中心, 行内遗留字段不再维护 (清空)
    if (existing) {
      await db.run(
        `UPDATE ai_reply_settings SET
           ai_enabled = ?, ai_config_id = ?, model_name = '', api_key = '', base_url = '',
           max_discount_percent = ?, max_discount_amount = ?, max_bargain_rounds = ?,
           custom_prompts = ?, updated_at = CURRENT_TIMESTAMP
         WHERE cookie_id = ?`,
        [ai_enabled, ai_config_id, max_discount_percent, max_discount_amount, max_bargain_rounds, custom_prompts, cookieId],
      )
    } else {
      await db.run(
        `INSERT INTO ai_reply_settings (
           cookie_id, ai_enabled, ai_config_id, model_name, api_key, base_url,
           max_discount_percent, max_discount_amount, max_bargain_rounds, custom_prompts
         ) VALUES (?, ?, ?, '', '', '', ?, ?, ?, ?)`,
        [cookieId, ai_enabled, ai_config_id, max_discount_percent, max_discount_amount, max_bargain_rounds, custom_prompts],
      )
    }

    return ok({ cookie_id: cookieId, ai_enabled, ai_config_id }, 'AI 配置已保存')
  }),
)
