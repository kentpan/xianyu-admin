/** POST /api/delivery — create a delivery rule.
 *
 *  trigger_type:
 *    - 'keyword'  (默认): 买家消息包含 keyword 时触发
 *    - 'payment' : 买家支付成功后按 item_id 绑定的商品自动触发 (引擎监听付款事件执行)
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event) || {}

    const trigger_type = (body.trigger_type || '').toString() === 'payment' ? 'payment' : 'keyword'
    const keyword = (body.keyword || '').toString().trim()
    const item_id = (body.item_id || '').toString().trim()
    const card_id = Number(body.card_id)
    if (!card_id) throw new ApiError(400, '请选择关联卡券')

    const card = await db.get('SELECT id FROM cards WHERE id = ?', [card_id])
    if (!card) throw new ApiError(404, '关联卡券不存在')

    if (trigger_type === 'keyword') {
      if (!keyword) throw new ApiError(400, '关键词不能为空')
    } else {
      if (!item_id) throw new ApiError(400, '付款触发必须绑定商品')
      const item = await db.get('SELECT id FROM item_info WHERE item_id = ?', [item_id])
      if (!item) throw new ApiError(404, '绑定的商品不存在, 请先到「商品管理」同步商品')
    }

    // 付款触发天然只在已付款后发生, require_paid 恒为 1
    const requirePaid = trigger_type === 'payment' ? 1 : (body.require_paid === false || body.require_paid === 0 ? 0 : 1)
    // 无需邮寄发货模式: none=仅发消息, dummy_consign=平台无需邮寄确认发货
    const shipMode = body.ship_mode === 'dummy_consign' || body.ship_mode === 'none' ? String(body.ship_mode) : ''

    const r = await db.run(
      `INSERT INTO delivery_rules (keyword, card_id, delivery_count, enabled, require_paid, description, trigger_type, item_id, ship_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        keyword,
        card_id,
        Math.max(1, Number(body.delivery_count ?? 1) || 1),
        body.enabled === false || body.enabled === 0 ? 0 : 1,
        requirePaid,
        (body.description || '').toString().trim() || null,
        trigger_type,
        item_id,
        shipMode,
      ],
    )

    return ok({ id: r.lastInsertId }, '发货规则已创建')
  }),
)
