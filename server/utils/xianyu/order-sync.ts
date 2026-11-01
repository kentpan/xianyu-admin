/**
 * xianyu/order-sync — 卖家订单列表同步 (orders 表 upsert)。
 *
 * 供两条链路共用:
 *   1. 一键同步 (/api/orders/refresh): 每账号拉全部状态订单 (ALL) 入库
 *   2. 引擎定时订单同步 (engine-manager orderSyncTick): 每账号拉待发货订单 (NOT_SHIP) 入库
 *
 * 解决的核心问题: 此前订单只能靠交易卡片被动入库, 付款卡片丢失/解析失败时
 * "已付款待发货"订单永远不存在于本地库 → 无法自动发货、订单页无数据。
 * 订单列表主动拉取让订单先于卡片落库, 卡片兜底链路有据可查。
 */
import type { SellerOrderItem } from './mtop'
import { getDb } from '../db'

export interface SoldOrderSyncResult {
  inserted: number
  updated: number
  total: number
}

/**
 * 闲鱼订单 createTime ("YYYY-MM-DD HH:MM:SS" 文本; 兼容毫秒时间戳/ISO) →
 * SQLite TIMESTAMP 文本 (UTC, 与 CURRENT_TIMESTAMP 同语义)。
 * 解析失败回退当前时刻 —— 绝不静默失真 (订单页「创建时间」必须是真实下单时间,
 * 而非同步入库时刻; 曾因丢弃该字段导致同批同步订单时间全部显示为同一秒, 排查被误导)。
 */
function normalizeCreatedAt(text: string): string {
  const s = String(text || '').trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s
  const n = Number(s)
  const d = n > 0 ? new Date(n) : new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ')
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * 单条标准化订单 upsert 进 orders 表 (幂等)。
 * 覆盖语义: 上游非空字段更新本地; 本地发货标记 (system_shipped) / 会话关联 (chat_id) /
 * 发货记录 (consign_*) 永不覆盖; is_bargain 只增不减 (MAX); created_at 只在首次
 * 插入时写入闲鱼真实下单时间, 冲突更新永不覆盖。
 */
export async function upsertSoldOrder(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  o: SellerOrderItem,
): Promise<void> {
  await db
    .run(
      `INSERT INTO orders (order_id, item_id, buyer_id, order_status, cookie_id, amount, quantity, is_bargain,
                           receiver_name, receiver_phone, receiver_address, version, system_shipped, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
       ON CONFLICT(order_id) DO UPDATE SET
         order_status = CASE WHEN excluded.order_status != 'unknown' THEN excluded.order_status ELSE orders.order_status END,
         item_id = CASE WHEN excluded.item_id != '' THEN excluded.item_id ELSE orders.item_id END,
         buyer_id = CASE WHEN excluded.buyer_id != '' THEN excluded.buyer_id ELSE orders.buyer_id END,
         amount = CASE WHEN excluded.amount != '' AND excluded.amount != '0' THEN excluded.amount ELSE orders.amount END,
         quantity = excluded.quantity,
         is_bargain = MAX(COALESCE(orders.is_bargain, 0), excluded.is_bargain),
         receiver_name = CASE WHEN excluded.receiver_name != '' THEN excluded.receiver_name ELSE orders.receiver_name END,
         receiver_phone = CASE WHEN excluded.receiver_phone != '' THEN excluded.receiver_phone ELSE orders.receiver_phone END,
         receiver_address = CASE WHEN excluded.receiver_address != '' THEN excluded.receiver_address ELSE orders.receiver_address END,
         updated_at = CURRENT_TIMESTAMP`,
      [
        o.order_id,
        o.item_id || '',
        o.buyer_id || '',
        o.order_status || 'unknown',
        cookieId,
        o.amount || '',
        String(o.quantity || '1'),
        o.is_bargain ? 1 : 0,
        o.receiver_name || '',
        o.receiver_phone || '',
        o.receiver_address || '',
        normalizeCreatedAt(o.created_at_text),
      ],
    )
    .catch(() => {})
}

/** 批量 upsert (首查存在性区分 inserted/updated, 供前端展示新拉取单数)。 */
export async function upsertSoldOrders(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  items: SellerOrderItem[],
): Promise<SoldOrderSyncResult> {
  let inserted = 0
  let updated = 0
  for (const o of items) {
    if (!o?.order_id) continue
    const before = await db
      .get<{ order_id: string }>('SELECT order_id FROM orders WHERE order_id = ?', [o.order_id])
      .catch(() => null)
    await upsertSoldOrder(db, cookieId, o)
    if (before) updated++
    else inserted++
  }
  return { inserted, updated, total: items.length }
}
