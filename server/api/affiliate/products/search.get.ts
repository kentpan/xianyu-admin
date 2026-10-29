/**
 * GET /api/affiliate/products/search — 联盟选品搜索。
 * Query: ?account_id=&keyword=&page=&page_size=&sort=&min_price=&max_price=&has_coupon=
 *
 * 实际调联盟 API (淘宝/京东/拼多多/Amazon 等支持服务端搜索的)。
 * 不支持服务端搜索的联盟返回提示让用户去官网选品。
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const q = getQuery(event)
    const accountId = Number(q.account_id || 0)
    const keyword = String(q.keyword || '').trim()
    if (!accountId) throw new ApiError(400, 'account_id 不能为空')
    if (!keyword) throw new ApiError(400, '请输入搜索关键词')

    const acc = await db.get<any>('SELECT * FROM affiliate_accounts WHERE id = ? AND user_id = ?', [accountId, payload.userId])
    if (!acc) throw new ApiError(404, '联盟账号不存在')
    if (!acc.enabled) throw new ApiError(400, '该联盟账号已停用')

    const { getNetworkById } = await import('../../../utils/affiliate-networks')
    const net = getNetworkById(acc.network_id)
    if (!net) throw new ApiError(404, '联盟配置不存在')

    // 解析凭据 (password 字段从真实存储读取)
    let creds: Record<string, string> = {}
    try { creds = JSON.parse(acc.credentials || '{}') } catch {}

    if (!net.supportsServerSearch) {
      return ok({
        items: [],
        total: 0,
        message: `${net.nameCn || net.name} 暂不支持系统内选品搜索, 请前往官网选品`,
        externalUrl: net.registerUrl,
        network: net,
      })
    }

    // 调用对应联盟的选品 API (各联盟签名不同, 这里分发)
    const { searchProducts } = await import('../../../utils/affiliate/search')
    const page = Number(q.page || 1)
    const pageSize = Number(q.page_size || 20)
    try {
      const result = await searchProducts(net, creds, {
        keyword,
        page,
        page_size: pageSize,
        sort: String(q.sort || 'default'),
        min_price: q.min_price ? Number(q.min_price) : undefined,
        max_price: q.max_price ? Number(q.max_price) : undefined,
        has_coupon: q.has_coupon === 'true' || q.has_coupon === '1',
      })
      // 写入 affiliate_products (upsert, 不覆盖 collected=1 的)
      for (const it of result.items) {
        await db.run(
          `INSERT INTO affiliate_products (user_id, account_id, network_id, item_id, title, price, commission_rate, commission_amount, pic_url, item_url, shop_name, category, sales, coupon, raw_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, item_id) DO UPDATE SET
             title = excluded.title, price = excluded.price, commission_rate = excluded.commission_rate,
             commission_amount = excluded.commission_amount, pic_url = excluded.pic_url, item_url = excluded.item_url,
             shop_name = excluded.shop_name, category = excluded.category, sales = excluded.sales,
             coupon = excluded.coupon, raw_data = excluded.raw_data, updated_at = CURRENT_TIMESTAMP`,
          [payload.userId, accountId, acc.network_id, it.item_id, it.title, it.price, it.commission_rate, it.commission_amount, it.pic_url, it.item_url, it.shop_name, it.category, it.sales, it.coupon ? JSON.stringify(it.coupon) : null, JSON.stringify(it.raw || {})],
        )
      }
      return ok({ items: result.items, total: result.total, page, page_size: pageSize, network: net })
    } catch (e: any) {
      // 联盟 API 调用失败 — 返回友好提示而非 500
      return ok({
        items: [],
        total: 0,
        message: `选品搜索失败: ${e.message || '联盟 API 错误'}。请检查凭据是否正确, 或前往官网选品`,
        externalUrl: net.registerUrl,
        network: net,
      })
    }
  }),
)
