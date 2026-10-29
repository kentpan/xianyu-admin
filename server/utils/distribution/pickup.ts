/**
 * 提货服务 (no-order pickup)
 *
 * 流程:
 *   1. 根据 dock_id 查询 dock_record
 *   2. 校验 dock_record.user_id (对接创建者) 的 secret_key 与请求 key 一致
 *   3. 加载 card 内容 (text_content / data_content / api_config)
 *   4. 创建 agent_order (order_no = `PICKUP${dockId}_${ts}`)
 *   5. 在事务内调用 settleLevel1Order / settleLevel2Order
 *   6. 返回卡券内容字符串; 结算失败则记录 settle_remark 但仍返回内容
 *
 * 提货扣费使用 dock_price (一级=card_price, 二级=parent.sub_dock_price) 作为 sale_price
 */
// (DatabaseAdapter, ApiError types are auto-imported)
import { calcFee } from './fee'
import { settleLevel1Order, settleLevel2Order } from './settlement'
import { fmtMoney } from './decimal'
import { renderCodeTemplate, persistCardCode } from '../card-code'

export interface PickupResult {
  content: string
  agentOrderId: number
  settleOk: boolean
  settleRemark: string | null
}

/** 提货入口 */
export async function doPickup(
  db: DatabaseAdapter,
  secretKey: string,
  dockId: number,
): Promise<PickupResult> {
  if (!secretKey || !dockId) {
    throw new ApiError(400, '参数错误: 缺少 key 或 dock_id')
  }

  const dock = await db.get<{
    id: number; user_id: number; card_id: number; level: number
    parent_dock_id: number | null; source_user_id: number | null
    status: number
  }>(
    `SELECT id, user_id, card_id, level, parent_dock_id, source_user_id, status
     FROM dock_records WHERE id = ?`,
    [dockId],
  )
  if (!dock) throw new ApiError(404, '对接记录不存在')
  if (!dock.status) throw new ApiError(403, '对接记录已被禁用')

  // 校验对接创建者(distributor)的 secret_key
  const ownerRow = await db.get<{ secret_key: string | null; username: string }>(
    'SELECT secret_key, username FROM users WHERE id = ?',
    [dock.user_id],
  )
  if (!ownerRow) throw new ApiError(404, '对接用户不存在')
  if (!ownerRow.secret_key || ownerRow.secret_key !== secretKey) {
    throw new ApiError(403, '提货秘钥无效')
  }

  // 加载卡券 (含货主 / 对接价 / fee_payer / 卡密生成配置)
  const card = await db.get<{
    id: number; user_id: number; name: string; type: string
    text_content: string | null; data_content: string | null
    api_config: string | null; image_url: string | null
    price: string | null; fee_payer: string | null
    code_length: number | null; code_letters: number | null
    code_digits: number | null; code_case: string | null; code_template: string | null
    enabled: number
  }>(
    `SELECT id, user_id, name, type, text_content, data_content, api_config, image_url,
            price, fee_payer, code_length, code_letters, code_digits, code_case, code_template,
            enabled FROM cards WHERE id = ?`,
    [dock.card_id],
  )
  if (!card) throw new ApiError(404, '卡券不存在')
  if (!card.enabled) throw new ApiError(403, '卡券已被禁用')

  const ownerUserId = card.user_id
  const cardPrice = card.price || '0.00'
  const feePayer = card.fee_payer || 'distributor'

  // 一级: dock_price = card_price
  // 二级: dock_price = parent.sub_dock_price (fallback card_price)
  let level2Cost = '0.00'
  let level1UserId = 0
  let parentDockRecordId = 0
  if (dock.level === 2) {
    if (!dock.parent_dock_id || !dock.source_user_id) {
      throw new ApiError(400, '二级对接记录缺少 parent_dock_id / source_user_id')
    }
    level1UserId = dock.source_user_id
    parentDockRecordId = dock.parent_dock_id
    const parent = await db.get<{ sub_dock_price: string | null; status: number }>(
      'SELECT sub_dock_price, status FROM dock_records WHERE id = ?',
      [parentDockRecordId],
    )
    if (!parent) throw new ApiError(404, '一级对接记录不存在')
    if (!parent.status) throw new ApiError(403, '一级对接记录已被禁用')
    level2Cost = parent.sub_dock_price || cardPrice
  }

  const dockLevel = dock.level === 2 ? 2 : 1
  const dockPrice = dockLevel === 2 ? level2Cost : cardPrice
  const salePrice = dockPrice // pickup 无买家付款, sale_price = dock_price

  // 计算手续费
  const fee = await calcFee(db, salePrice)

  // profit = sale - dock_price = 0 (pickup 模式)
  const profit = '0.00'

  // 创建 agent_order
  const orderNo = `PICKUP${dockId}_${Date.now()}`

  // 取卡券内容 (卡密型: 生成随机码并落生成记录/核销账本, 订单号用提货单号回溯)
  let content: string
  if (card.type === 'code') {
    const code = await persistCardCode(db, card, { orderId: orderNo })
    content = renderCodeTemplate(card.code_template, code || '')
  } else {
    content = extractCardContent(card)
  }

  const insertRes = await db.run(
    `INSERT INTO agent_orders (
      user_id, order_no, item_id, card_id, dock_record_id, dock_level,
      sale_price, dock_price, card_price, level2_cost, profit,
      fee_amount, fee_payer, upstream_user_id, upstream_dock_record_id,
      owner_user_id, delivery_content, buyer_id, status, settle_remark,
      created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'delivered', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      dock.user_id,
      orderNo,
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
      content,
    ],
  )
  const agentOrderId = Number(insertRes.lastInsertId)

  // 结算 (在事务内, 失败不抛出, 记录 settle_remark)
  let settleOk = true
  let settleRemark: string | null = null
  try {
    await db.transaction(async () => {
      if (dockLevel === 1) {
        await settleLevel1Order({
          db, orderNo, dealerUserId: dock.user_id, ownerUserId,
          dockRecordId: dock.id, agentOrderId,
          salePrice: fmtMoney(salePrice),
          cardPrice: fmtMoney(cardPrice),
          feePayer, feeAmount: fee.feeAmount,
        })
      } else {
        await settleLevel2Order({
          db, orderNo, dealerUserId: dock.user_id,
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
  } catch (e: any) {
    settleOk = false
    settleRemark = `结算失败: ${e?.message || String(e)}`.slice(0, 500)
    await db.run(
      `UPDATE agent_orders SET status = 'failed', settle_remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [settleRemark, agentOrderId],
    )
  }

  // 增加对接记录的发货次数
  try {
    await db.run(
      `UPDATE dock_records SET delivery_count = delivery_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [dock.id],
    )
  } catch {
    // 非关键失败, 忽略
  }

  return { content, agentOrderId, settleOk, settleRemark }
}

/** 根据卡券类型提取发货内容 (遗留 data 按行取首行; 卡密型已在上方生成处理) */
function extractCardContent(card: {
  type: string
  text_content: string | null
  data_content: string | null
  api_config: string | null
  image_url: string | null
}): string {
  switch (card.type) {
    case 'text':
      return card.text_content || ''
    case 'code':
    case 'data':
      return card.data_content || ''
    case 'api':
      // api_config 是 JSON 字符串, 直接返回原值 (调用方自行解析)
      return card.api_config || ''
    case 'image':
      return card.image_url || ''
    default:
      return card.text_content || card.data_content || card.api_config || card.image_url || ''
  }
}
