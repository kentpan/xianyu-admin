/**
 * POST /api/orders/refresh — 批量刷新订单状态 (语义对齐 butler /api/orders/refresh)。
 * Body: { cookie_id?: string, status?: string }
 *   - 仅刷新非稳定状态 (pending_ship / processing / refunding / unknown) 的订单;
 *     shipped / completed / cancelled 视为终态跳过, 与 butler needs_refresh 判定一致。
 *   - 逐单调 mtop.idle.web.trade.order.detail, 每单间隔 300ms 防风控。
 * 返回 { total, updated, no_change, failed, results[] }, 失败单据如实携带错误信息。
 */
const REFRESHABLE_STATUSES = ['pending_ship', 'processing', 'refunding', 'unknown']

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const cookieFilter = String(body?.cookie_id || '').trim()
    const statusFilter = String(body?.status || '').trim()

    const rows = await db.all<any>(
      `SELECT o.order_id, o.cookie_id, o.order_status FROM orders o
       ${cookieFilter ? 'WHERE o.cookie_id = ?' : ''} ORDER BY o.updated_at DESC LIMIT 500`,
      cookieFilter ? [cookieFilter] : [],
    )
    const targets = rows.filter(
      (r) =>
        REFRESHABLE_STATUSES.includes(String(r.order_status || 'unknown')) &&
        (!statusFilter || String(r.order_status) === statusFilter),
    )

    if (!targets.length) {
      return ok({ total: 0, updated: 0, no_change: 0, failed: 0, results: [] }, '没有需要刷新的订单')
    }

    // 按账号缓存 cookie, 避免逐单查库
    const cookieCache = new Map<string, string>()
    const results: { order_id: string; changed: boolean; error?: string }[] = []
    let updated = 0
    let noChange = 0
    let failed = 0

    for (const t of targets) {
      const orderId = String(t.order_id)
      const cookieId = String(t.cookie_id || '')
      try {
        let cookieStr = cookieCache.get(cookieId) || ''
        if (!cookieStr) {
          const acct = await db.get<any>('SELECT value FROM cookies WHERE id = ?', [cookieId])
          if (!acct?.value) throw new Error(`账号 ${cookieId} 不存在或 Cookie 为空`)
          cookieStr = acct.value
          cookieCache.set(cookieId, cookieStr)
        }

        const { detail, retMsg, finalCookieStr } = await fetchOrderDetail(cookieStr, orderId)
        if (finalCookieStr && finalCookieStr !== cookieStr) {
          cookieCache.set(cookieId, finalCookieStr)
          await db.run('UPDATE cookies SET value = ? WHERE id = ?', [finalCookieStr, cookieId])
        }
        if (!detail) throw new Error(retMsg || '闲鱼接口未返回订单数据')

        const sets: string[] = []
        const params: unknown[] = []
        if (detail.order_status && detail.order_status !== 'unknown') {
          sets.push('order_status = ?')
          params.push(detail.order_status)
        }
        if (detail.buyer_id) {
          sets.push('buyer_id = ?')
          params.push(detail.buyer_id)
        }
        if (detail.price) {
          sets.push('amount = ?')
          params.push(detail.price)
        }
        if (detail.receiver_name) {
          sets.push('receiver_name = ?')
          params.push(detail.receiver_name)
        }
        if (detail.receiver_phone) {
          sets.push('receiver_phone = ?')
          params.push(detail.receiver_phone)
        }
        if (detail.receiver_address) {
          sets.push('receiver_address = ?')
          params.push(detail.receiver_address)
        }
        sets.push('updated_at = CURRENT_TIMESTAMP')
        await db.run(`UPDATE orders SET ${sets.join(', ')} WHERE order_id = ?`, [...params, orderId])

        const changed = detail.order_status !== String(t.order_status || 'unknown')
        if (changed) updated++
        else noChange++
        results.push({ order_id: orderId, changed })
      } catch (e: any) {
        failed++
        results.push({ order_id: orderId, changed: false, error: String(e?.message || e) })
      }
      // 单间间隔防风控
      await new Promise((r) => setTimeout(r, 300))
    }

    return ok({ total: targets.length, updated, no_change: noChange, failed, results })
  }),
)
