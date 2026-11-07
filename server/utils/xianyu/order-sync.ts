/**
 * xianyu/order-sync — 卖家订单列表同步 (orders 表 upsert)。
 *
 * 供两条链路共用:
 *   1. 一键同步 (/api/orders/refresh): 每账号拉全部状态订单 (ALL) 入库
 *   2. 引擎定时订单同步 (engine-manager orderSyncTick + 代理触发 /api/engine/orders-sync):
 *      v2.2.5 起每账号同样拉全部状态订单 (ALL) 入库 (待发货自愈落库仍包含其中)
 *
 * 三道防线 (订单数据可信性):
 *   ① 账号隔离: 逐单复核响应中的卖家身份字段 (seller_id) 与账号 uid, 不符的订单
 *      绝不入库并计入 blocked 供调用方显性报错 (防串号 Cookie / 会话漂移静默污染订单库)
 *   ② 删除屏蔽: 已被用户在订单页删除的订单号记录在 deleted_orders 表, 同步永不拉回
 *      (否则删除后被下一轮同步原样恢复, 表现为「删都删不掉」)
 *   ③ 时间真源: created_at 用闲鱼返回的真实下单时间, 且每次同步回填修复
 *      (历史上曾只写首次插入值, 同批同步的订单时间全部显示为同一秒且永不自愈)
 */
import type { SellerOrderItem, SellerOrderItemFull } from './mtop'
import { cookieIdUid } from './mtop'
import { getDb } from '../db'

export interface SoldOrderSyncResult {
  inserted: number
  updated: number
  total: number
  /** 账号隔离拦截数: 响应中卖家身份与账号 uid 不符的订单 (未入库)。 */
  blocked: number
  /** (v2.3.5) 被拦截订单号样例 (最多 3 个) — 拦截必须显性可查, 绝不允许再静默
   * (v2.3.0~v2.3.4 深扫 seller_id 误染买家/他人 uid, 拦光自己的订单却零日志, 是
   * 11-06 起收货人数据断流的主因)。全部放行后此项恒为空数组。 */
  blockedSamples: string[]
  /** 删除屏蔽数: 命中 deleted_orders 屏蔽表的订单 (未入库)。 */
  skippedDeleted: number
  /** (v2.2.7) 单条落库失败明细 (SQL 错误原文, 截断) — 绝不静默吞错, 计数只统计真实成功。 */
  errors: string[]
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
  // 状态时间 (付款/发货/完成/取消): 列表接口未携带时为空串, 不写入不伪造
  const statusTimes: Array<[string, string, string]> = [
    ['paid_at', 'paid_at_text', normalizeCreatedAt(String(o.paid_at_text || ''))],
    ['shipped_at', 'shipped_at_text', normalizeCreatedAt(String(o.shipped_at_text || ''))],
    ['finished_at', 'finished_at_text', normalizeCreatedAt(String(o.finished_at_text || ''))],
    ['cancelled_at', 'cancelled_at_text', normalizeCreatedAt(String(o.cancelled_at_text || ''))],
  ]
  // (v2.3.5) 存在性检查读容错: 此查询只决定返回 inserted/updated 统计值, 不是落库
  // 本体 — D1 读额度超限时 SELECT 会抛错, 绝不能让它拖死后面的 upsert 写语句 (D1 写
  // 额度独立, 读挂时写必须照常落库; v2.3.4 之前读挂 = 整单落库失败被 errors 吞掉,
  // 订单只能靠卡片兜底 INSERT, 无收货人/无状态时间)。失败时按 'unknown' 统计。
  let before: { order_id: string } | null = null
  try {
    before = await db.get<{ order_id: string }>('SELECT order_id FROM orders WHERE order_id = ?', [o.order_id])
  } catch {
    before = null
  }

  // 动态拼 created_at: 解析成功才写/回填, 失败时插入走列默认值、更新保留本地
  // .join('') 必须显式调用: timeCols 是数组, 直接内插模板字符串会触发 Array.toString()
  // 的逗号连接, 与元素自带的逗号叠加成 ", ," 双逗号 → SQLite 语法错误
  // (D1 实测: near ",": syntax error at offset 280, 带状态时间的订单全部落库失败)
  const timeCols = statusTimes.filter(([, , v]) => v).map(([col]) => `, ${col}`).join('')
  const timePlaceholders = statusTimes.filter(([, , v]) => v).map(() => ', ?').join('')
  const cols = `order_id, item_id, buyer_id, order_status, cookie_id, amount, quantity, is_bargain,
                receiver_name, receiver_phone, receiver_address, version, system_shipped${createdAt ? ', created_at' : ''}${timeCols}`
  const vals = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0${createdAt ? ', ?' : ''}${timePlaceholders}`
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
  for (const [, , v] of statusTimes) {
    if (v) base.push(v)
  }

  // 状态时间更新语义: 上游有值才覆盖 (状态只会向前演进, 空值绝不抹掉本地已有时间)
  const timeUpdateSets = statusTimes
    .filter(([, , v]) => v)
    .map(([col]) => `, ${col} = excluded.${col}`)
    .join('')

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
         ${createdAt ? ", created_at = excluded.created_at" : ""}${timeUpdateSets},
         updated_at = CURRENT_TIMESTAMP`,
      base,
    )
  // (v2.2.7) 不再静默吞错 (旧版此处挂 .catch 吞掉一切 SQL 错误): 失败向上抛, 由批量层
  // 逐单捕获计入 errors 显性上报 — 此前吞错导致锁竞争失败被计入 updated/inserted, 同步
  // 计数虚报 (图 1: "更新 118 单" 实际 0 单落库), 订单状态/字段永不更新且无任何报错。
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
  const errors: string[] = []
  const blockedSamples: string[] = []
  for (const o of items) {
    if (!o?.order_id) continue
    // 账号隔离复核: 响应自带卖家身份且与账号 uid 不符 = 他人店铺订单, 绝不入库。
    // (v2.3.5) 拦截必须显性可查: 记录样例订单号供上层日志/同步结果展示 —
    // v2.3.0~v2.3.4 的静默拦截让列表同步全灭却零痕可查, 是收货人断流的主因。
    const sid = String((o as SellerOrderItem & { seller_id?: string }).seller_id || '').trim()
    if (sid && expectedUid && /^\d+$/.test(sid) && sid !== expectedUid) {
      blocked++
      if (blockedSamples.length < 3) blockedSamples.push(String(o.order_id))
      continue
    }
    // (v2.2.7) 逐单捕获写库错误计入 errors 显性上报, 计数只统计真实落库;
    // 流程不中断 (与既有语义一致), 但绝不再把失败虚报成成功
    try {
      const r = await upsertSoldOrder(db, cookieId, o)
      if (r === 'inserted') inserted++
      else if (r === 'updated') updated++
      else if (r === 'deleted') skippedDeleted++
      else blocked++
    } catch (e: any) {
      errors.push(`订单 ${String(o.order_id).slice(0, 24)} 落库失败: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  return { inserted, updated, total: items.length, blocked, blockedSamples, skippedDeleted, errors }
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

/* ------------------- 全量订单同步 (v2.2.6): 不判断区分账号全量入库 -------------------
 * 与既有 upsertSoldOrders 的本质区别 (按需求保留 2.1.7 的全量语义):
 *   - 不做账号隔离复核 (响应中卖家身份与账号 uid 是否相符不判断) — 拉到的全部订单
 *     原样入库, cookie_id 归属拉取所用账号; 卖家身份 (seller_id) 随单落库备查。
 *   - 商品名称 (item_title) / 买家昵称 (buyer_nick) / 商品真实单价 (item_price) 随单真实落库
 *     (orders 表 v2.2.6 新列; 状态时间 created/paid/shipped/finished/cancelled 同步写入)。
 *   - 仍尊重 deleted_orders 屏蔽表 (用户手动删除的订单不复活, 与「删都删不掉」既有承诺一致)。
 * 仅供全量订单同步 (/api/orders/sync-all, 闲鱼趋势 tab) 使用, 既有同步链路零改动。 */

/**
 * 单条完整订单 upsert 进 orders 表 (幂等, 无账号隔离)。
 * 覆盖语义与 upsertSoldOrder 对齐: 上游非空字段更新本地; 本地发货标记 (system_shipped) /
 * 会话关联 (chat_id) / 发货记录 (consign_*) 永不覆盖; is_bargain 只增不减 (MAX);
 * created_at 用闲鱼真实下单时间写入并回填; item_title/buyer_nick/item_price/seller_id
 * 非空才覆盖 (响应未携带绝不抹掉本地已有值)。
 */
export async function upsertSoldOrderFull(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  o: SellerOrderItemFull,
): Promise<'inserted' | 'updated' | 'deleted'> {
  if (!o?.order_id) return 'updated'
  if (await isDeletedOrder(db, String(o.order_id))) return 'deleted'

  const createdAt = normalizeCreatedAt(o.created_at_text)
  const statusTimes: Array<[string, string]> = [
    ['paid_at', normalizeCreatedAt(String(o.paid_at_text || ''))],
    ['shipped_at', normalizeCreatedAt(String(o.shipped_at_text || ''))],
    ['finished_at', normalizeCreatedAt(String(o.finished_at_text || ''))],
    ['cancelled_at', normalizeCreatedAt(String(o.cancelled_at_text || ''))],
  ]
  // (v2.3.5) 存在性检查读容错 (与 upsertSoldOrder 同语义): 统计值查询绝不能拖死写语句
  let before: { order_id: string } | null = null
  try {
    before = await db.get<{ order_id: string }>('SELECT order_id FROM orders WHERE order_id = ?', [o.order_id])
  } catch {
    before = null
  }

  // 同上: .join('') 必须显式调用, 防数组内插触发 Array.toString() 双逗号语法错误
  const timeCols = statusTimes.filter(([, v]) => v).map(([col]) => `, ${col}`).join('')
  const timePlaceholders = statusTimes.filter(([, v]) => v).map(() => ', ?').join('')
  const cols = `order_id, item_id, item_title, buyer_id, buyer_nick, seller_id, item_price, order_status, cookie_id,
                amount, quantity, is_bargain, receiver_name, receiver_phone, receiver_address,
                version, system_shipped${createdAt ? ', created_at' : ''}${timeCols}`
  const vals = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0${createdAt ? ', ?' : ''}${timePlaceholders}`
  const base = [
    o.order_id,
    o.item_id || '',
    o.item_title || '',
    o.buyer_id || '',
    o.buyer_nick || '',
    o.seller_id || '',
    o.item_price || '',
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
  for (const [, v] of statusTimes) {
    if (v) base.push(v)
  }

  const timeUpdateSets = statusTimes
    .filter(([, v]) => v)
    .map(([col]) => `, ${col} = excluded.${col}`)
    .join('')

  // (v2.3.0 修复) 新插入也必须打 full_sync 标: v2.2.6 只在 ON CONFLICT 更新分支写
  // sync_source='full_sync', 首次插入的订单永远无标记 → 闲鱼趋势 tab 全量口径
  // (sync_source='full_sync') 永远查不到它们, 列表恒为空
  await db
    .run(
      `INSERT INTO orders (${cols}, sync_source)
       VALUES (${vals}, 'full_sync')
       ON CONFLICT(order_id) DO UPDATE SET
         order_status = CASE WHEN excluded.order_status != 'unknown' THEN excluded.order_status ELSE orders.order_status END,
         item_id = CASE WHEN excluded.item_id != '' THEN excluded.item_id ELSE orders.item_id END,
         item_title = CASE WHEN excluded.item_title != '' THEN excluded.item_title ELSE orders.item_title END,
         buyer_id = CASE WHEN excluded.buyer_id != '' THEN excluded.buyer_id ELSE orders.buyer_id END,
         buyer_nick = CASE WHEN excluded.buyer_nick != '' THEN excluded.buyer_nick ELSE orders.buyer_nick END,
         seller_id = CASE WHEN excluded.seller_id != '' THEN excluded.seller_id ELSE orders.seller_id END,
         item_price = CASE WHEN excluded.item_price != '' THEN excluded.item_price ELSE orders.item_price END,
         amount = CASE WHEN excluded.amount != '' AND excluded.amount != '0' THEN excluded.amount ELSE orders.amount END,
         quantity = excluded.quantity,
         is_bargain = MAX(COALESCE(orders.is_bargain, 0), excluded.is_bargain),
         receiver_name = CASE WHEN excluded.receiver_name != '' THEN excluded.receiver_name ELSE orders.receiver_name END,
         receiver_phone = CASE WHEN excluded.receiver_phone != '' THEN excluded.receiver_phone ELSE orders.receiver_phone END,
         receiver_address = CASE WHEN excluded.receiver_address != '' THEN excluded.receiver_address ELSE orders.receiver_address END,
         sync_source = 'full_sync'
         ${createdAt ? ', created_at = excluded.created_at' : ''}${timeUpdateSets},
         updated_at = CURRENT_TIMESTAMP`,
      base,
    )
  // (v2.2.7) 不再静默吞错 (旧版此处挂 .catch 吞掉一切 SQL 错误): 失败向上抛由批量层计入
  // errors 显性上报; 全量同步链路专属列 sync_source='full_sync' 随单打标 (趋势 tab 全量列表依据)
  return before ? 'updated' : 'inserted'
}

export interface SoldOrderFullSyncResult {
  inserted: number
  updated: number
  total: number
  /** 删除屏蔽数: 命中 deleted_orders 屏蔽表的订单 (未入库, 不复活用户删除的订单)。 */
  skippedDeleted: number
  /** (v2.2.7) 单条落库失败明细 — 绝不静默吞错, 计数只统计真实成功。 */
  errors: string[]
}

/** 批量全量 upsert (无账号隔离, 商品名称/买家昵称随单落库, sync_source='full_sync' 打标)。 */
export async function upsertSoldOrdersFull(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  items: SellerOrderItemFull[],
): Promise<SoldOrderFullSyncResult> {
  let inserted = 0
  let updated = 0
  let skippedDeleted = 0
  const errors: string[] = []
  for (const o of items) {
    if (!o?.order_id) continue
    // (v2.2.7) 逐单捕获写库错误计入 errors 显性上报, 计数只统计真实落库
    try {
      const r = await upsertSoldOrderFull(db, cookieId, o)
      if (r === 'inserted') inserted++
      else if (r === 'updated') updated++
      else skippedDeleted++
    } catch (e: any) {
      errors.push(`订单 ${String(o.order_id).slice(0, 24)} 落库失败: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  return { inserted, updated, total: items.length, skippedDeleted, errors }
}
