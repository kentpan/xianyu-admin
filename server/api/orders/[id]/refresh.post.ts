/**
 * POST /api/orders/:id/refresh — 从闲鱼实查订单详情并回写本地库。
 * api = mtop.idle.web.trade.order.detail (与 goofish 订单详情页同源接口),
 * 状态/买家/金额/收货人变化全部落库; 平台风控或接口错误如实返回 502, 不伪造成功。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const id = getRouterParam(event, 'id') || ''
    const db = await getDb()

    const existing = await db.get<any>('SELECT order_id, cookie_id, order_status FROM orders WHERE order_id = ?', [id])
    if (!existing) throw new ApiError(404, '订单不存在')
    const cookieId = String(existing.cookie_id || '')
    if (!cookieId) throw new ApiError(400, '订单缺少账号归属, 无法刷新')

    const acct = await db.get<any>('SELECT id, value FROM cookies WHERE id = ?', [cookieId])
    if (!acct) throw new ApiError(404, '订单归属的账号不存在或已删除')
    if (!acct.value) throw new ApiError(400, '账号 Cookie 为空, 请先重新扫码登录')

    // fetchOrderDetail is auto-imported by Nitro from server/utils/xianyu/mtop.ts
    const { detail, retMsg, finalCookieStr } = await fetchOrderDetail(acct.value, id)

    // 回写轮换后的 cookie (尤其是 _m_h5_tk)
    if (finalCookieStr && finalCookieStr !== acct.value) {
      await db.run('UPDATE cookies SET value = ? WHERE id = ?', [finalCookieStr, cookieId])
    }

    if (!detail) throw new ApiError(502, `闲鱼接口未返回订单数据: ${retMsg || '未知错误'}`)

    // 仅回写有变化的字段
    const sets: string[] = []
    const params: unknown[] = []
    const prevStatus = String(existing.order_status || 'unknown')
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
    if (detail.item_id) {
      sets.push('item_id = ?')
      params.push(detail.item_id)
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
    if (detail.receiver_city) {
      sets.push('receiver_city = ?')
      params.push(detail.receiver_city)
    }
    sets.push('updated_at = CURRENT_TIMESTAMP')
    await db.run(`UPDATE orders SET ${sets.join(', ')} WHERE order_id = ?`, [...params, id])

    const changed = detail.order_status !== prevStatus
    return ok(
      {
        order_id: id,
        previous_status: prevStatus,
        current_status: detail.order_status,
        status_text: detail.status_text,
        changed,
      },
      changed ? `订单状态已更新: ${prevStatus} → ${detail.order_status}` : '订单状态无变化',
    )
  }),
)
