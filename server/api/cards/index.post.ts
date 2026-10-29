/** POST /api/cards — create a new card. */
export default defineEventHandler(
  withApi(async (event) => {
    const u = requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const name = (body.name || '').toString().trim()
    const type = (body.type || '').toString().trim()
    if (!name) throw new ApiError(400, '卡券名称不能为空')
    if (!['api', 'text', 'code', 'data', 'image'].includes(type)) {
      throw new ApiError(400, '卡券类型无效，可选 api / text / code / data / image')
    }

    // 卡密生成配置 (code 型): 长度默认 6, 英文/数字默认勾选, 大小写默认混合, 文案空则引擎用默认
    const codeLength = Math.min(32, Math.max(4, Math.round(Number(body.code_length ?? 6) || 6)))
    const codeLetters = body.code_letters === 0 || body.code_letters === false ? 0 : 1
    const codeDigits = body.code_digits === 0 || body.code_digits === false ? 0 : 1
    const codeCase = ['lower', 'upper', 'mixed'].includes(String(body.code_case)) ? String(body.code_case) : 'mixed'
    const codeTemplate = (body.code_template ?? '').toString().trim().slice(0, 500) || null

    // 分销对接字段 (返佣系统)
    const price = body.price !== undefined && body.price !== null && body.price !== ''
      ? String(body.price)
      : '0.00'
    const isDockable = body.is_dockable ? 1 : 0
    const feePayer = body.fee_payer === 'dealer' ? 'dealer' : 'distributor'
    const minPrice = body.min_price !== undefined && body.min_price !== null && body.min_price !== ''
      ? String(body.min_price)
      : null
    const dockVisibility = body.dock_visibility === 'dealer_only' ? 'dealer_only' : 'public'

    const r = await db.run(
      `INSERT INTO cards (
        name, type, api_config, text_content, data_content, image_url,
        code_length, code_letters, code_digits, code_case, code_template,
        description, enabled, delay_seconds, is_multi_spec, spec_name, spec_value, user_id,
        price, is_dockable, fee_payer, min_price, dock_visibility
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        type,
        body.api_config ?? null,
        body.text_content ?? null,
        body.data_content ?? null,
        body.image_url ?? null,
        codeLength,
        codeLetters,
        codeDigits,
        codeCase,
        codeTemplate,
        body.description ?? null,
        body.enabled === false || body.enabled === 0 ? 0 : 1,
        Number(body.delay_seconds ?? 0) || 0,
        body.is_multi_spec ? 1 : 0,
        body.spec_name ?? null,
        body.spec_value ?? null,
        u.userId,
        price,
        isDockable,
        feePayer,
        minPrice,
        dockVisibility,
      ],
    )

    return ok({ id: r.lastInsertId }, '卡券已创建')
  }),
)
