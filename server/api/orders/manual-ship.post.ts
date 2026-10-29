/** POST /api/orders/manual-ship — manually mark an order as shipped.
 *  Body: { order_id, mode: 'status_only' | 'full' }
 *
 *  After marking shipped, attempts to trigger the commission settlement engine
 *  if the cookie owner has any active docked card (level-1 or level-2).
 *  Settlement failure is non-fatal (mirrors the Python auto-delivery pattern).
 */

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}
    const order_id = (body.order_id || '').toString().trim()
    const mode = (body.mode || 'status_only').toString() === 'full' ? 'full' : 'status_only'

    if (!order_id) throw new ApiError(400, '订单号不能为空')

    const existing = await db.get('SELECT order_id FROM orders WHERE order_id = ?', [order_id])
    if (!existing) throw new ApiError(404, '订单不存在')

    // full 模式: 先调用平台真实无需邮寄发货接口 (mtop.taobao.idle.logistic.consign.dummy), 失败不阻塞状态标记
    let consign: { success: boolean; message: string } | null = null
    if (mode === 'full') {
      const order = await db.get<any>('SELECT cookie_id FROM orders WHERE order_id = ?', [order_id])
      const acct = order?.cookie_id ? await db.get<any>('SELECT value FROM cookies WHERE id = ?', [order.cookie_id]) : null
      if (acct?.value) {
        const { confirmOrderShipped } = await import('../../utils/xianyu/mtop')
        const r = await confirmOrderShipped(String(acct.value), order_id)
        consign = { success: r.success, message: r.message }
        await db
          .run(
            'UPDATE orders SET consign_status = ?, consign_message = ?, consign_at = CURRENT_TIMESTAMP WHERE order_id = ?',
            [r.success ? 'success' : 'failed', r.message.slice(0, 240), order_id],
          )
          .catch(() => {})
      } else {
        consign = { success: false, message: '账号 Cookie 缺失, 无法调用平台发货接口' }
      }
    }

    await db.run(
      `UPDATE orders SET order_status = 'shipped', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
      [order_id],
    )

    // 触发返佣结算 (失败不影响发货状态)
    try {
      await trySettleCommission(db, order_id)
    } catch (e: any) {
      console.log(`[manual-ship] commission trigger error for ${order_id}:`, e?.message || e)
    }

    return ok({ order_id, mode, shipped: true, consign }, consign ? (consign.success ? '无需邮寄发货成功' : `平台发货接口返回: ${consign.message}`) : '已标记为已发货')
  }),
)

/**
 * 触发返佣结算
 *
 * 策略 (xianyu-admin 无 card_item_relations 表, 采用简化逻辑):
 *   1. 查订单 → cookie_id → cookies.user_id = 分销商
 *   2. 查该分销商最近一条 active dock_record (status=1), 不限定 item_id
 *   3. 若找到, 根据 level 调用 settleLevel1Order / settleLevel2Order
 *   4. 找不到 → 视为非对接订单, 跳过
 */
async function trySettleCommission(db: Awaited<ReturnType<typeof getDb>>, orderId: string): Promise<void> {
  const order = await db.get<{
    order_id: string; item_id: string | null; cookie_id: string | null
    amount: string | null; buyer_id: string | null
  }>(
    'SELECT order_id, item_id, cookie_id, amount, buyer_id FROM orders WHERE order_id = ?',
    [orderId],
  )
  if (!order || !order.cookie_id) return

  const cookie = await db.get<{ user_id: number }>(
    'SELECT user_id FROM cookies WHERE id = ?',
    [order.cookie_id],
  )
  if (!cookie || !cookie.user_id) return

  const dealerUserId = cookie.user_id

  // 找该分销商最近一条 active 对接记录
  const dock = await db.get<{
    id: number; user_id: number; card_id: number; level: number
    parent_dock_id: number | null; source_user_id: number | null
  }>(
    `SELECT id, user_id, card_id, level, parent_dock_id, source_user_id
     FROM dock_records
     WHERE user_id = ? AND status = 1
     ORDER BY created_at DESC
     LIMIT 1`,
    [dealerUserId],
  )
  if (!dock) return // 非对接订单

  // 加载卡券
  const card = await db.get<{
    id: number; user_id: number; price: string | null; fee_payer: string | null; enabled: number
  }>(
    'SELECT id, user_id, price, fee_payer, enabled FROM cards WHERE id = ?',
    [dock.card_id],
  )
  if (!card || !card.enabled) return

  const ownerUserId = card.user_id
  const cardPrice = card.price || '0.00'
  const feePayer = card.fee_payer || 'distributor'
  const salePrice = order.amount || '0.00'
  const dockLevel = dock.level === 2 ? 2 : 1

  // 二级: 取 parent dock_record.sub_dock_price
  let level2Cost = '0.00'
  let level1UserId = 0
  let parentDockRecordId = 0
  if (dockLevel === 2) {
    if (!dock.parent_dock_id || !dock.source_user_id) return
    level1UserId = dock.source_user_id
    parentDockRecordId = dock.parent_dock_id
    const parent = await db.get<{ sub_dock_price: string | null; status: number }>(
      'SELECT sub_dock_price, status FROM dock_records WHERE id = ?',
      [parentDockRecordId],
    )
    if (!parent || !parent.status) return
    level2Cost = parent.sub_dock_price || cardPrice
  }

  const dockPrice = dockLevel === 2 ? level2Cost : cardPrice
  const fee = await calcFee(db, salePrice)

  // profit = sale_price - dock_price (仅记录)
  let profit = '0.00'
  try {
    profit = toDecimal(salePrice).sub(toDecimal(dockPrice)).toFixed(2)
  } catch {
    profit = '0.00'
  }

  // 创建 agent_order
  const insertRes = await db.run(
    `INSERT INTO agent_orders (
      user_id, order_no, item_id, card_id, dock_record_id, dock_level,
      sale_price, dock_price, card_price, level2_cost, profit,
      fee_amount, fee_payer, upstream_user_id, upstream_dock_record_id,
      owner_user_id, delivery_content, buyer_id, status, settle_remark,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'delivered', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      dealerUserId,
      orderId,
      order.item_id || null,
      dock.card_id,
      dock.id,
      dockLevel,
      fmtMoney(salePrice),
      fmtMoney(dockPrice),
      dockLevel === 2 ? fmtMoney(cardPrice) : null,
      dockLevel === 2 ? fmtMoney(level2Cost) : null,
      profit,
      fee.feeAmount,
      feePayer,
      dockLevel === 2 ? level1UserId : ownerUserId,
      dockLevel === 2 ? parentDockRecordId : null,
      ownerUserId,
      order.buyer_id || null,
    ],
  )
  const agentOrderId = Number(insertRes.lastInsertId)

  // 结算
  try {
    await db.transaction(async () => {
      if (dockLevel === 1) {
        await settleLevel1Order({
          db, orderNo: orderId, dealerUserId, ownerUserId,
          dockRecordId: dock.id, agentOrderId,
          salePrice: fmtMoney(salePrice),
          cardPrice: fmtMoney(cardPrice),
          feePayer, feeAmount: fee.feeAmount,
        })
      } else {
        await settleLevel2Order({
          db, orderNo: orderId, dealerUserId,
          level1UserId, ownerUserId,
          dockRecordId: dock.id, parentDockRecordId,
          agentOrderId,
          salePrice: fmtMoney(salePrice),
          level2Cost: fmtMoney(level2Cost),
          level1Cost: fmtMoney(cardPrice),
          feePayer, feeAmount: fee.feeAmount,
        })
      }
    })
    await db.run(
      `UPDATE agent_orders SET status = 'settled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [agentOrderId],
    )
    // 增加对接记录的发货次数
    await db.run(
      `UPDATE dock_records SET delivery_count = delivery_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [dock.id],
    )
  } catch (e: any) {
    const remark = `结算失败: ${e?.message || String(e)}`.slice(0, 500)
    await db.run(
      `UPDATE agent_orders SET status = 'failed', settle_remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [remark, agentOrderId],
    )
    // 不抛出, 仅记录 (符合 Python 实现的容错模式)
  }
}
