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

    // 付款触发绑定的商品校验
    if (body.item_id !== undefined && (body.item_id || '').toString().trim()) {
      const item = await db.get('SELECT id FROM item_info WHERE item_id = ?', [(body.item_id || '').toString().trim()])
      if (!item) throw new ApiError(404, '绑定的商品不存在, 请先到「商品管理」同步商品')
    }

    const allowed: Record<string, string> = {
      keyword: 'keyword',
      card_id: 'card_id',
      delivery_count: 'delivery_count',
      description: 'description',
      item_id: 'item_id',
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
    if (body.trigger_type !== undefined) {
      const tt = body.trigger_type === 'payment' ? 'payment' : 'keyword'
      const row = await db.get<{ keyword: string; item_id: string }>(
        'SELECT keyword, item_id FROM delivery_rules WHERE id = ?', [id],
      )
      if (tt === 'payment') {
        // 切到付款触发: 必须有商品(本次传入或已绑定), 并清空关键词条件
        const iid = body.item_id !== undefined ? (body.item_id || '').toString().trim() : (row?.item_id || '')
        if (!iid) throw new ApiError(400, '付款触发必须绑定商品')
        fields.push('keyword = ?')
        params.push('')
      } else {
        // 切到关键词触发: 必须有关键词(本次传入或已有), 并清空商品绑定
        const kw = body.keyword !== undefined ? (body.keyword || '').toString().trim() : (row?.keyword || '')
        if (!kw) throw new ApiError(400, '关键词不能为空')
        fields.push('item_id = ?')
        params.push('')
      }
      fields.push('trigger_type = ?')
      params.push(tt)
    }
    if (body.enabled !== undefined) {
      fields.push('enabled = ?')
      params.push(body.enabled ? 1 : 0)
    }
    if (body.require_paid !== undefined) {
      fields.push('require_paid = ?')
      params.push(body.require_paid ? 1 : 0)
    }
    if (body.ship_mode !== undefined) {
      const sm = String(body.ship_mode)
      fields.push('ship_mode = ?')
      params.push(sm === 'dummy_consign' || sm === 'none' ? sm : '')
    }

    if (fields.length === 0) throw new ApiError(400, '没有需要更新的字段')
    params.push(id)
    await db.run(`UPDATE delivery_rules SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params)

    return ok({ id }, '规则已更新')
  }),
)
