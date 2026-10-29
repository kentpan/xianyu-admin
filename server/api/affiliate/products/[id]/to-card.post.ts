/**
 * POST /api/affiliate/products/:id/to-card — 将选品商品转为卡券 (闭环核心)。
 *
 * 闭环流程:
 *   联盟选品 → (本接口) 生成卡券(含联盟推广链接) → 绑定闲鱼商品(item_id) → 关键词自动回复
 *   买家咨询闲鱼商品 → 自动回复发送卡券内容(联盟链接) → 买家点击购买 → 赚取佣金
 *
 * Body: { item_id?: string, keyword?: string, cookie_id?: string }
 *  - item_id: 关联的闲鱼商品 ID (可选, 用于自动回复匹配)
 *  - keyword: 自动回复关键词 (可选, 如商品标题)
 *  - cookie_id: 闲鱼账号 ID (可选, 关键词需绑定账号)
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const db = await getDb()
    const id = Number(getRouterParam(event, 'id'))
    if (!id) throw new ApiError(400, '无效的商品 id')
    const body = await readBody(event)

    const prod = await db.get<any>('SELECT * FROM affiliate_products WHERE id = ? AND user_id = ?', [id, payload.userId])
    if (!prod) throw new ApiError(404, '选品商品不存在')

    // 构造卡券内容: 联盟推广链接 + 文案
    const cardName = `[选品] ${prod.title?.slice(0, 40) || prod.item_id}`
    const textContent = buildPromoText(prod)
    const cardType = 'text' // 文本卡券

    // 创建卡券
    const cardRes = await db.run(
      `INSERT INTO cards (name, type, text_content, image_url, description, enabled, user_id, item_id, price, is_dockable)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
      [
        cardName,
        cardType,
        textContent,
        prod.pic_url || '',
        `来自联盟 ${prod.network_id} 的选品, 佣金率 ${prod.commission_rate || '未知'}`,
        payload.userId,
        body?.item_id || '',
        prod.price || '0',
      ],
    )
    const cardId = cardRes.lastInsertRowid

    // 如果有关键词 + cookie_id, 自动创建关键词回复规则
    if (body?.keyword && body?.cookie_id) {
      const kw = String(body.keyword).trim()
      const cookieId = String(body.cookie_id).trim()
      if (kw && cookieId) {
        await db.run(
          `INSERT INTO keywords (cookie_id, keyword, reply, item_id, type) VALUES (?, ?, ?, ?, 'text')`,
          [cookieId, kw, textContent, body?.item_id || ''],
        )
      }
    }

    // 标记选品已转卡券
    await db.run('UPDATE affiliate_products SET collected = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id])

    await auditLog(event, {
      action: 'create',
      module: 'cards',
      targetType: 'card',
      targetId: String(cardId),
      desc: `选品转卡券: ${cardName}`,
    })

    return ok({ card_id: cardId, message: '已生成卡券, 可前往「卡券管理」查看并绑定闲鱼商品' }, '卡券已生成')
  }),
)

/** 构造推广文案。 */
function buildPromoText(prod: any): string {
  const lines: string[] = []
  lines.push(`【${prod.title || '精选好物'}】`)
  if (prod.price) lines.push(`💰 价格: ¥${prod.price}`)
  if (prod.shop_name) lines.push(`🏪 店铺: ${prod.shop_name}`)
  if (prod.coupon) {
    try {
      const c = typeof prod.coupon === 'string' ? JSON.parse(prod.coupon) : prod.coupon
      if (c.amount) lines.push(`🎫 优惠券: 满${c.start_fee || 0}减${c.amount}元`)
    } catch {}
  }
  if (prod.item_url) lines.push(`\n👉 购买链接: ${prod.item_url}`)
  lines.push(`\n(客服自动回复, 如有疑问请联系客服)`)
  return lines.join('\n')
}
