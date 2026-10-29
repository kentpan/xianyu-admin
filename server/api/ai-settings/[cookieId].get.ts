/** GET /api/ai-settings/:cookieId — read AI reply settings for one account. */
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

    const row = await db.get<any>('SELECT * FROM ai_reply_settings WHERE cookie_id = ?', [cookieId])

    if (!row) {
      // 未配置过: 返回默认值 (不落库, 保存时才写入)
      return ok({
        cookie_id: cookieId,
        ai_enabled: 0,
        ai_config_id: 0,
        model_name: 'qwen-plus',
        api_key: '',
        api_key_masked: false,
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        max_discount_percent: 10,
        max_discount_amount: 100,
        max_bargain_rounds: 3,
        custom_prompts: '',
        ai_config: null,
      })
    }

    let aiConfig: any = null
    if (Number(row.ai_config_id) > 0) {
      aiConfig = await db.get<any>(
        'SELECT id, name, model_name, base_url, enabled FROM ai_configs WHERE id = ?',
        [row.ai_config_id],
      )
    }

    const hasKey = !!row.api_key
    return ok({
      ...row,
      // 不向前端回传明文 API Key, 用掩码表示"已配置"
      api_key: hasKey ? '******' : '',
      api_key_masked: hasKey,
      ai_config: aiConfig,
    })
  }),
)
