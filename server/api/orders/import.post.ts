/** POST /api/orders/import — bulk upsert orders by order_id. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}
    const orders: any[] = Array.isArray(body.orders) ? body.orders : (Array.isArray(body) ? body : [])

    if (orders.length === 0) throw new ApiError(400, '没有可导入的订单')

    let inserted = 0
    let updated = 0

    await db.transaction(async () => {
      for (const o of orders) {
        const order_id = (o.order_id || '').toString().trim()
        if (!order_id) continue
        const exists = await db.get('SELECT order_id FROM orders WHERE order_id = ?', [order_id])
        if (exists) {
          await db.run(
            `UPDATE orders SET
              item_id = COALESCE(NULLIF(?, ''), item_id),
              buyer_id = COALESCE(NULLIF(?, ''), buyer_id),
              spec_name = COALESCE(?, spec_name),
              spec_value = COALESCE(?, spec_value),
              quantity = COALESCE(?, quantity),
              amount = COALESCE(?, amount),
              order_status = COALESCE(NULLIF(?, ''), order_status),
              cookie_id = COALESCE(NULLIF(?, ''), cookie_id),
              chat_id = COALESCE(?, chat_id),
              is_bargain = COALESCE(?, is_bargain),
              receiver_name = COALESCE(?, receiver_name),
              receiver_phone = COALESCE(?, receiver_phone),
              receiver_address = COALESCE(?, receiver_address),
              receiver_city = COALESCE(?, receiver_city),
              updated_at = CURRENT_TIMESTAMP
            WHERE order_id = ?`,
            [
              o.item_id ?? '', o.buyer_id ?? '',
              o.spec_name ?? null, o.spec_value ?? null,
              o.quantity ?? null, o.amount ?? null,
              o.order_status ?? '', o.cookie_id ?? '',
              o.chat_id ?? null, o.is_bargain ?? null,
              o.receiver_name ?? null, o.receiver_phone ?? null,
              o.receiver_address ?? null, o.receiver_city ?? null,
              order_id,
            ],
          )
          updated++
        } else {
          await db.run(
            `INSERT INTO orders (
              order_id, item_id, buyer_id, spec_name, spec_value,
              quantity, amount, order_status, cookie_id, chat_id, is_bargain,
              receiver_name, receiver_phone, receiver_address, receiver_city
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              order_id,
              o.item_id ?? '', o.buyer_id ?? '',
              o.spec_name ?? null, o.spec_value ?? null,
              o.quantity ?? null, o.amount ?? null,
              o.order_status ?? 'unknown', o.cookie_id ?? '',
              o.chat_id ?? '', o.is_bargain ?? 0,
              o.receiver_name ?? '', o.receiver_phone ?? '',
              o.receiver_address ?? '', o.receiver_city ?? '',
            ],
          )
          inserted++
        }
      }
    })

    return ok({ inserted, updated, total: orders.length }, `已导入 ${inserted} 条，更新 ${updated} 条`)
  }),
)
