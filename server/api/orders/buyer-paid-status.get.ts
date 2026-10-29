/**
 * GET /api/orders/buyer-paid-status — 查询买家是否已有已付款订单。
 *
 * 用途: 消息监听引擎 / 自动发货流程在触发发货前, 统一校验发消息的买家是否已付款,
 *       防止"未付款买家咨询发货"时误触发发货。
 *
 * 查询参数:
 *   cookie_id  必填 — 闲鱼账号 ID
 *   buyer_id   buyer_id 与 chat_id 至少提供一个 (优先 buyer_id 精确匹配)
 *   chat_id    会话 ID (无 buyer_id 时回退匹配)
 *   item_id    可选 — 限定商品 (校验"该买家是否已购买该商品")
 *
 * 已付款判定口径: 存在 order_status IN (pending_ship, shipped, completed) 的订单。
 *   - pending_ship 待发货  = 已付款, 未发货
 *   - shipped     已发货  = 已付款, 已发货
 *   - completed   已完成  = 已付款, 交易完成
 *   (cancelled / refunding / unknown 均视为未在有效付款状态)
 *
 * 返回: { paid: boolean, order: {...} | null, paid_statuses: string[] }
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const q = getQuery(event)
    const cookie_id = (q.cookie_id || '').toString().trim()
    const buyer_id = (q.buyer_id || '').toString().trim()
    const chat_id = (q.chat_id || '').toString().trim()
    const item_id = (q.item_id || '').toString().trim()

    if (!cookie_id) throw new ApiError(400, '缺少 cookie_id')
    if (!buyer_id && !chat_id) throw new ApiError(400, 'buyer_id 与 chat_id 至少提供一个')

    const db = await getDb()
    const PAID_STATUSES = ['pending_ship', 'shipped', 'completed']

    const conds: string[] = ['cookie_id = ?', `order_status IN (${PAID_STATUSES.map(() => '?').join(',')})`]
    const params: any[] = [cookie_id, ...PAID_STATUSES]
    if (buyer_id) {
      conds.push('buyer_id = ?')
      params.push(buyer_id)
    } else {
      conds.push('chat_id = ?')
      params.push(chat_id)
    }
    if (item_id) {
      conds.push('item_id = ?')
      params.push(item_id)
    }

    const order = await db.get<any>(
      `SELECT order_id, item_id, buyer_id, chat_id, order_status, amount, quantity, spec_value, created_at
       FROM orders
       WHERE ${conds.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 1`,
      params,
    )

    return ok({
      paid: !!order,
      order: order || null,
      paid_statuses: PAID_STATUSES,
    })
  }),
)
