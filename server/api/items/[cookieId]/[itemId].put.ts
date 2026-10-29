/** PUT /api/items/:cookieId/:itemId — update item flags. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const cookieId = getRouterParam(event, 'cookieId') || ''
    const itemId = getRouterParam(event, 'itemId') || ''
    const db = await getDb()
    const body = await readBody(event) || {}

    const existing = await db.get(
      'SELECT id FROM item_info WHERE cookie_id = ? AND item_id = ?',
      [cookieId, itemId],
    )
    if (!existing) throw new ApiError(404, '商品不存在')

    const fields: string[] = []
    const params: any[] = []
    if (body.is_multi_spec !== undefined) {
      fields.push('is_multi_spec = ?')
      params.push(body.is_multi_spec ? 1 : 0)
    }
    if (body.multi_quantity_delivery !== undefined) {
      fields.push('multi_quantity_delivery = ?')
      params.push(body.multi_quantity_delivery ? 1 : 0)
    }
    if (body.item_title !== undefined) {
      fields.push('item_title = ?')
      params.push(String(body.item_title))
    }
    if (body.item_category !== undefined) {
      fields.push('item_category = ?')
      params.push(String(body.item_category))
    }
    if (body.item_price !== undefined) {
      fields.push('item_price = ?')
      params.push(String(body.item_price))
    }

    if (fields.length === 0) throw new ApiError(400, '没有需要更新的字段')
    fields.push('updated_at = CURRENT_TIMESTAMP')
    params.push(cookieId, itemId)

    await db.run(
      `UPDATE item_info SET ${fields.join(', ')} WHERE cookie_id = ? AND item_id = ?`,
      params,
    )

    return ok({ cookieId, itemId }, '商品已更新')
  }),
)
