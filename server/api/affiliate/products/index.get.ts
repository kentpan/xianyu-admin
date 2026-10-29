/** GET /api/affiliate/products — 列出已采集/搜索过的商品。 Query: ?account_id=&keyword=&collected=&page=&page_size= */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const page = Number(q.page || 1)
    const pageSize = Number(q.page_size || 20)
    const offset = (page - 1) * pageSize

    const where: string[] = ['user_id = ?']
    const params: any[] = [payload.userId]
    if (q.account_id) { where.push('account_id = ?'); params.push(Number(q.account_id)) }
    if (q.collected === '1' || q.collected === 'true') { where.push('collected = 1') }
    if (q.keyword) { where.push('(title LIKE ? OR item_id LIKE ? OR shop_name LIKE ?)'); const k = `%${q.keyword}%`; params.push(k, k, k) }

    const rows = await db.all<any>(
      `SELECT * FROM affiliate_products WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    const totalRow = await db.get<any>(`SELECT count(*) c FROM affiliate_products WHERE ${where.join(' AND ')}`, params)
    return ok({ items: rows, total: totalRow?.c || 0, page, page_size: pageSize })
  }),
)
