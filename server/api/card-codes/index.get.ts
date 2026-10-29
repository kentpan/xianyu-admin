/**
 * GET /api/card-codes — 卡密生成记录分页 (登录可用)。
 * 记录卡密型卡券每次发货生成的随机码与分配上下文: 时间/卡密/卡券/账号/商品/订单/买家。
 * Query: page, pageSize (默认 20), keyword (卡密/订单号/买家/商品/账号/卡券名模糊)
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize || 20)))
    const keyword = (q.keyword || '').toString().trim()
    const cardId = Number(q.cardId || 0)

    const where: string[] = []
    const params: any[] = []
    if (keyword) {
      where.push('(code LIKE ? OR order_id LIKE ? OR buyer_id LIKE ? OR item_id LIKE ? OR cookie_id LIKE ? OR card_name LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (cardId > 0) {
      where.push('card_id = ?')
      params.push(cardId)
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM card_code_logs ${whereSql}`, params)
    const rows = await db.all<any>(
      `SELECT * FROM card_code_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    )

    return ok({ data: rows, total: totalRow?.c || 0, page, pageSize })
  }),
)
