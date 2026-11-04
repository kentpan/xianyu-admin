/** GET /api/orders — list orders with filters & pagination.
 *
 * v2.2.5 scope 归属筛选 (默认 all, 向后兼容既有调用方):
 *   - mine  = 仅「已添加账号」的订单 (cookie_id 在 cookies 表中) — 订单管理「我的订单」tab
 *   - other = 仅「非已添加账号」的订单 (cookie_id 为空或不在 cookies 表中, 含已删除账号的历史订单)
 *             — 订单管理「闲鱼趋势」tab 的分页列表
 *   - all   = 不过滤 (默认, 既有行为不变)
 */
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
    const scope = (q.scope || 'all').toString().trim()

    const where: string[] = []
    const params: any[] = []

    // 归属筛选先于其它条件, 参数占位顺序固定 (cookie_id 空串占位)
    if (scope === 'mine') {
      where.push("o.cookie_id IS NOT NULL AND o.cookie_id != '' AND o.cookie_id IN (SELECT id FROM cookies)")
    } else if (scope === 'other') {
      where.push("(o.cookie_id IS NULL OR o.cookie_id = '' OR o.cookie_id NOT IN (SELECT id FROM cookies))")
    }
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
        o.order_id, o.item_id, o.buyer_id, o.buyer_nick, o.seller_id, o.spec_name, o.spec_value,
        o.quantity, o.amount, o.item_price, o.order_status, o.cookie_id, o.chat_id,
        o.is_bargain, o.receiver_name, o.receiver_phone, o.receiver_address,
        o.receiver_city, o.created_at, o.updated_at,
        o.paid_at, o.shipped_at, o.finished_at, o.cancelled_at,
        COALESCE(NULLIF(o.item_title, ''), ii.item_title) AS item_title,
        c.remark AS cookie_remark
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
