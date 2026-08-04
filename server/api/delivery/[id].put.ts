/** PUT /api/delivery/:id — update a delivery rule. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的规则 ID')
    const db = await getDb()
    const body = await readBody(event) || {}

    const existing = await db.get('SELECT id FROM delivery_rules WHERE id = ?', [id])
    if (!existing) throw new ApiError(404, '规则不存在')

    if (body.card_id !== undefined) {
      const card = await db.get('SELECT id FROM cards WHERE id = ?', [Number(body.card_id)])
      if (!card) throw new ApiError(404, '关联卡券不存在')
    }

    const allowed: Record<string, string> = {
      keyword: 'keyword',
      card_id: 'card_id',
      delivery_count: 'delivery_count',
      description: 'description',
    }
    const fields: string[] = []
    const params: any[] = []
    for (const [k, col] of Object.entries(allowed)) {
      if (body[k] !== undefined) {
        let v = body[k]
        if (k === 'card_id' || k === 'delivery_count') v = Number(v) || 0
        else v = v === null ? null : String(v)
        fields.push(`${col} = ?`)
        params.push(v)
      }
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?')
      params.push(body.enabled ? 1 : 0)
    }

    if (fields.length === 0) throw new ApiError(400, '没有需要更新的字段')
    params.push(id)
    await db.run(`UPDATE delivery_rules SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)

    return ok({ id }, '规则已更新')
  }),
)
