/**
 * GET /api/card-consumes — 卡密消费记录分页 (登录可用)。
 * 记录每次外部核销请求 (成功/失败): 时间/卡密/卡券/订单/买家/消费方 Key/IP/结果/说明。
 * Query: page, pageSize (默认 20), keyword (卡密/订单号/买家/卡券名/Key名/IP 模糊), result (success/failed)
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize || 20)))
    const keyword = (q.keyword || '').toString().trim()
    const result = (q.result || '').toString().trim()

    const where: string[] = []
    const params: any[] = []
    if (keyword) {
      where.push('(code LIKE ? OR order_id LIKE ? OR buyer_id LIKE ? OR card_name LIKE ? OR api_key_name LIKE ? OR ip LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (result === 'success' || result === 'failed') {
      where.push('result = ?')
      params.push(result)
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM card_consume_logs ${whereSql}`, params)
    const rows = await db.all<any>(
      `SELECT * FROM card_consume_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    )

    return ok({ data: rows, total: totalRow?.c || 0, page, pageSize })
  }),
)
