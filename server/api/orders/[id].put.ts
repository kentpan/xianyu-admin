/** PUT /api/orders/:id — update order status / receiver info. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()
    const body = await readBody(event) || {}

    const existing = await db.get('SELECT order_id FROM orders WHERE order_id = ?', [id])
    if (!existing) throw new ApiError(404, '订单不存在')

    const fields: string[] = []
    const params: any[] = []
    const allowed = [
      'order_status',
      'receiver_name',
      'receiver_phone',
      'receiver_address',
      'receiver_city',
      'spec_name',
      'spec_value',
      'quantity',
      'amount',
    ]
    for (const k of allowed) {
      if (body[k] !== undefined) {
        fields.push(`${k} = ?`)
        params.push(String(body[k]))
      }
    }

    if (fields.length === 0) throw new ApiError(400, '没有需要更新的字段')
    fields.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)

    await db.run(`UPDATE orders SET ${fields.join(', ')} WHERE order_id = ?`, params)
    return ok({ order_id: id }, '订单已更新')
  }),
)
