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

    if (body.type !== undefined && !['api', 'text', 'data', 'image'].includes(body.type)) {
      throw new ApiError(400, '卡券类型无效')
    }

    const allowed: Record<string, string> = {
      name: 'name',
      type: 'type',
      api_config: 'api_config',
      text_content: 'text_content',
      data_content: 'data_content',
      image_url: 'image_url',
      description: 'description',
      delay_seconds: 'delay_seconds',
      spec_name: 'spec_name',
      spec_value: 'spec_value',
    }
    const fields: string[] = []
    const params: any[] = []
    for (const [k, col] of Object.entries(allowed)) {
      if (body[k] !== undefined) {
        let v = body[k]
        if (k === 'delay_seconds') v = Number(v) || 0
        else v = v === null ? null : String(v)
        fields.push(`${col} = ?`)
        params.push(v)
      }
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?')
      params.push(body.enabled ? 1 : 0)
    }
    if (body.is_multi_spec !== undefined) {
      fields.push('is_multi_spec = ?')
      params.push(body.is_multi_spec ? 1 : 0)
    }

    if (fields.length === 0) throw new ApiError(400, '没有需要更新的字段')
    params.push(id)
    await db.run(`UPDATE cards SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)

    return ok({ id }, '卡券已更新')
  }),
)
