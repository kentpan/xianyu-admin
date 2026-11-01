/**
 * xianyu/order-sync — 卖家订单列表同步 (orders 表 upsert)。
 *
 * 供两条链路共用:
 *   1. 一键同步 (/api/orders/refresh): 每账号拉全部状态订单 (ALL) 入库
 *   2. 引擎定时订单同步 (engine-manager orderSyncTick): 每账号拉待发货订单 (NOT_SHIP) 入库
 *
 * 三道防线 (订单数据可信性):
 *   ① 账号隔离: 逐单复核响应中的卖家身份字段 (seller_id) 与账号 uid, 不符的订单
 *      绝不入库并计入 blocked 供调用方显性报错 (防串号 Cookie / 会话漂移静默污染订单库)
 *   ② 删除屏蔽: 已被用户在订单页删除的订单号记录在 deleted_orders 表, 同步永不拉回
 *      (否则删除后被下一轮同步原样恢复, 表现为「删都删不掉」)
 *   ③ 时间真源: created_at 用闲鱼返回的真实下单时间, 且每次同步回填修复
 *      (历史上曾只写首次插入值, 同批同步的订单时间全部显示为同一秒且永不自愈)
 */
import type { SellerOrderItem } from './mtop'
import { cookieIdUid } from './mtop'
import { getDb } from '../db'

export interface SoldOrderSyncResult {
  inserted: number
  updated: number
  total: number
  /** 账号隔离拦截数: 响应中卖家身份与账号 uid 不符的订单 (未入库)。 */
  blocked: number
  /** 删除屏蔽数: 命中 deleted_orders 屏蔽表的订单 (未入库)。 */
  skippedDeleted: number
}

/**
 * 闲鱼订单 createTime ("YYYY-MM-DD HH:MM:SS" 文本; 兼容毫秒时间戳/ISO) →
 * SQLite TIMESTAMP 文本 (UTC, 与 CURRENT_TIMESTAMP 同语义)。
 * 解析失败返回 '' (调用方据此跳过该字段: 插入走 DEFAULT CURRENT_TIMESTAMP,
 * 更新保留本地值) —— 绝不用当前时刻冒充下单时间静默失真。
 */
export function normalizeCreatedAt(text: string): string {
  const s = String(text || '').trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s
  const n = Number(s)
  const d = n > 0 ? new Date(n) : new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ')
  return ''
}

/** 该订单是否被用户删除过 (deleted_orders 屏蔽表)。 */
async function isDeletedOrder(db: Awaited<ReturnType<typeof getDb>>, orderId: string): Promise<boolean> {
  try {
    const row = await db.get<{ order_id: string }>('SELECT order_id FROM deleted_orders WHERE order_id = ?', [orderId])
    return !!row
  } catch {
    return false
  }
}

/**
 * 单条标准化订单 upsert 进 orders 表 (幂等)。
 * 覆盖语义: 上游非空字段更新本地; 本地发货标记 (system_shipped) / 会话关联 (chat_id) /
 * 发货记录 (consign_*) 永不覆盖; is_bargain 只增不减 (MAX); created_at 用闲鱼真实
 * 下单时间写入并在解析成功时回填 (自愈历史脏数据; 解析失败保留本地值)。
 *
 * @returns 'inserted' | 'updated' | 'deleted' (命中屏蔽表跳过) | 'blocked' (卖家身份不符)
 */
export async function upsertSoldOrder(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  o: SellerOrderItem,
): Promise<'inserted' | 'updated' | 'deleted' | 'blocked'> {
  if (!o?.order_id) return 'blocked'
  if (await isDeletedOrder(db, String(o.order_id))) return 'deleted'

  const createdAt = normalizeCreatedAt(o.created_at_text)
  const before = await db
    .get<{ order_id: string }>('SELECT order_id FROM orders WHERE order_id = ?', [o.order_id])
    .catch(() => null)

  // 动态拼 created_at: 解析成功才写/回填, 失败时插入走列默认值、更新保留本地
  const cols = `order_id, item_id, buyer_id, order_status, cookie_id, amount, quantity, is_bargain,
                receiver_name, receiver_phone, receiver_address, version, system_shipped${createdAt ? ', created_at' : ''}`
  const vals = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0${createdAt ? ', ?' : ''}`
  const base = [
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
  ]
  if (createdAt) base.push(createdAt)

  await db
    .run(
      `INSERT INTO orders (${cols})
       VALUES (${vals})
       ON CONFLICT(order_id) DO UPDATE SET
         order_status = CASE WHEN excluded.order_status != 'unknown' THEN excluded.order_status ELSE orders.order_status END,
         item_id = CASE WHEN excluded.item_id != '' THEN excluded.item_id ELSE orders.item_id END,
         buyer_id = CASE WHEN excluded.buyer_id != '' THEN excluded.buyer_id ELSE orders.buyer_id END,
         amount = CASE WHEN excluded.amount != '' AND excluded.amount != '0' THEN excluded.amount ELSE orders.amount END,
         quantity = excluded.quantity,
         is_bargain = MAX(COALESCE(orders.is_bargain, 0), excluded.is_bargain),
         receiver_name = CASE WHEN excluded.receiver_name != '' THEN excluded.receiver_name ELSE orders.receiver_name END,
         receiver_phone = CASE WHEN excluded.receiver_phone != '' THEN excluded.receiver_phone ELSE orders.receiver_phone END,
         receiver_address = CASE WHEN excluded.receiver_address != '' THEN excluded.receiver_address ELSE orders.receiver_address END
         ${createdAt ? ", created_at = excluded.created_at" : ""},
         updated_at = CURRENT_TIMESTAMP`,
      base,
    )
    .catch(() => {})
  return before ? 'updated' : 'inserted'
}

/**
 * 批量 upsert (首查存在性区分 inserted/updated, 供前端展示新拉取单数)。
 *
 * @param expectedSellerUid 期望的卖家 uid (账号 id 去 xy_ 前缀); 订单响应中带卖家身份
 *        字段且与之不符的订单一律拦截不入库 (账号隔离)。'' 表示无法判定 (放行)。
 */
export async function upsertSoldOrders(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  items: SellerOrderItem[],
): Promise<SoldOrderSyncResult> {
  const expectedUid = cookieIdUid(cookieId)
  let inserted = 0
  let updated = 0
  let blocked = 0
  let skippedDeleted = 0
  for (const o of items) {
    if (!o?.order_id) continue
    // 账号隔离复核: 响应自带卖家身份且与账号 uid 不符 = 他人店铺订单, 绝不入库
    const sid = String((o as SellerOrderItem & { seller_id?: string }).seller_id || '').trim()
    if (sid && expectedUid && /^\d+$/.test(sid) && sid !== expectedUid) {
      blocked++
      continue
    }
    const r = await upsertSoldOrder(db, cookieId, o)
    if (r === 'inserted') inserted++
    else if (r === 'updated') updated++
    else if (r === 'deleted') skippedDeleted++
    else blocked++
  }
  return { inserted, updated, total: items.length, blocked, skippedDeleted }
}

/** 记录用户删除的订单号 (同步屏蔽): 删除后任何同步链路都不再拉回。 */
export async function rememberDeletedOrder(
  db: Awaited<ReturnType<typeof getDb>>,
  orderId: string,
  cookieId = '',
  reason = 'user_delete',
): Promise<void> {
  await db
    .run(
      `INSERT INTO deleted_orders (order_id, cookie_id, reason) VALUES (?, ?, ?)
       ON CONFLICT(order_id) DO NOTHING`,
      [String(orderId), String(cookieId || ''), String(reason || 'user_delete')],
    )
    .catch(() => {})
}
