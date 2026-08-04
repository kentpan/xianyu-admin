/** GET /api/orders — list orders with filters & pagination. */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)

    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize || 20)))
    const status = (q.status || '').toString().trim()
    const cookie_id = (q.cookie_id || '').toString().trim()
    const keyword = (q.keyword || '').toString().trim()
    const dateFrom = (q.dateFrom || '').toString().trim()
    const dateTo = (q.dateTo || '').toString().trim()
    const amountMin = (q.amountMin || '').toString().trim()
    const amountMax = (q.amountMax || '').toString().trim()

    const where: string[] = []
    const params: any[] = []

    if (status && status !== 'all') {
      where.push('o.order_status = ?')
      params.push(status)
    }
    if (cookie_id) {
      where.push('o.cookie_id = ?')
      params.push(cookie_id)
    }
    if (keyword) {
      where.push('(o.order_id LIKE ? OR o.buyer_id LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`)
    }
    if (dateFrom) {
      where.push('date(o.created_at) >= date(?)')
      params.push(dateFrom)
    }
    if (dateTo) {
      where.push('date(o.created_at) <= date(?)')
      params.push(dateTo)
    }
    if (amountMin) {
      where.push('CAST(o.amount AS REAL) >= ?')
      params.push(Number(amountMin))
    }
    if (amountMax) {
      where.push('CAST(o.amount AS REAL) <= ?')
      params.push(Number(amountMax))
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM orders o ${whereSql}`,
      params,
    )
    const total = totalRow?.c || 0

    const offset = (page - 1) * pageSize
    const rows = await db.all(
      `SELECT
        o.order_id, o.item_id, o.buyer_id, o.spec_name, o.spec_value,
        o.quantity, o.amount, o.order_status, o.cookie_id, o.chat_id,
        o.is_bargain, o.receiver_name, o.receiver_phone, o.receiver_address,
        o.receiver_city, o.created_at, o.updated_at,
        ii.item_title, c.remark AS cookie_remark
      FROM orders o
      LEFT JOIN item_info ii ON ii.cookie_id = o.cookie_id AND ii.item_id = o.item_id
      LEFT JOIN cookies c ON c.id = o.cookie_id
      ${whereSql}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )

    return ok({ data: rows, total, page, pageSize })
  }),
)
