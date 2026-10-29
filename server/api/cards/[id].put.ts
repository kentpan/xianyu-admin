/** PUT /api/cards/:id — update card fields. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的卡券 ID')
    const db = await getDb()
    const body = await readBody(event) || {}

    const existing = await db.get('SELECT id FROM cards WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '卡券不存在')

    if (body.type !== undefined && !['api', 'text', 'code', 'data', 'image'].includes(body.type)) {
      throw new ApiError(400, '卡券类型无效')
    }

    const allowed: Record<string, string> = {
      name: 'name',
      type: 'type',
      api_config: 'api_config',
      text_content: 'text_content',
      data_content: 'data_content',
      image_url: 'image_url',
      code_case: 'code_case',
      code_template: 'code_template',
      description: 'description',
      delay_seconds: 'delay_seconds',
      spec_name: 'spec_name',
      spec_value: 'spec_value',
      price: 'price',
      min_price: 'min_price',
    }
    const fields: string[] = []
    const params: any[] = []
    for (const [k, col] of Object.entries(allowed)) {
      if (body[k] !== undefined) {
        let v = body[k]
        if (k === 'delay_seconds') v = Number(v) || 0
        else if (k === 'code_case' && !['lower', 'upper', 'mixed'].includes(String(v))) v = 'mixed'
        else if (k === 'code_template') v = String(v ?? '').trim().slice(0, 500) || null
        else v = v === null ? null : String(v)
        fields.push(`${col} = ?`)
        params.push(v)
      }
    }
    if (body.code_length !== undefined) {
      fields.push('code_length = ?')
      params.push(Math.min(32, Math.max(4, Math.round(Number(body.code_length) || 6))))
    }
    if (body.code_letters !== undefined) {
      fields.push('code_letters = ?')
      params.push(body.code_letters === 0 || body.code_letters === false ? 0 : 1)
    }
    if (body.code_digits !== undefined) {
      fields.push('code_digits = ?')
      params.push(body.code_digits === 0 || body.code_digits === false ? 0 : 1)
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?')
      params.push(body.enabled ? 1 : 0)
    }
    if (body.is_multi_spec !== undefined) {
      fields.push('is_multi_spec = ?')
      params.push(body.is_multi_spec ? 1 : 0)
    }
    if (body.is_dockable !== undefined) {
      fields.push('is_dockable = ?')
      params.push(body.is_dockable ? 1 : 0)
    }
    if (body.fee_payer !== undefined) {
      fields.push('fee_payer = ?')
      params.push(body.fee_payer === 'dealer' ? 'dealer' : 'distributor')
    }
    if (body.dock_visibility !== undefined) {
      fields.push('dock_visibility = ?')
      params.push(body.dock_visibility === 'dealer_only' ? 'dealer_only' : 'public')
    }

    if (fields.length === 0) throw new ApiError(400, '没有需要更新的字段')
    params.push(id)
    await db.run(`UPDATE cards SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)

    return ok({ id }, '卡券已更新')
  }),
)
