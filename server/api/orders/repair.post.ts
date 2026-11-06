/**
 * POST /api/orders/repair — 存量订单核验修复 (v2.3.0)。
 * Body: { limit?: number }
 *
 * 背景 (数据取证结论, v2.2.x 遗留三类解析缺陷存量):
 *   ① 时间堆积: 旧版首次入库把"入库时刻"当成下单时间写入 (order-sync 注释自认的
 *      历史 bug: 同批订单 created_at 全部为同一秒且永不自愈) — "11-01 一天 108 单"
 *      即此假象 (95 单挤在同一分钟入库时刻), 真实下单时间分布在更早日期。
 *   ② 订单号精度丢失: 旧版本某条链路 JSON.parse 把 19 位订单号当 double 处理,
 *      尾数被截断成 '0000' (如 5127388023283286000) — 此类订单号在平台侧已不存在,
 *      详情接口必查不到, 是确定的失真脏数据。
 *   ③ 卖家身份/买家昵称字段全空: 旧版解析路径未覆盖响应中的 seller/buyer 字段。
 *
 * 本接口逐单调订单详情接口 (mtop.idle.web.trade.order.detail, role=seller) 对账修复:
 *   - 详情 SUCCESS → 回填真实下单时间 (create_time_text 解析成功才写, 绝不伪造)、
 *     卖家身份 seller_id、买家昵称 (详情响应携带才写)
 *   - 详情失败: 仅"截断订单号"脏单 (order_id LIKE '%0000') 删除并记入 deleted_orders
 *     (reason=truncated_id) — 截断 ID 在平台侧必不存在, 删除绝无误伤; 其余失败只跳过
 *     (风控/系统错误计入 errors, 下轮再修), 真实订单绝无被删风险
 *   - 逐单间隔 350ms 防风控; 整体预算 50s; limit 控制单次核验量 (默认 60, 优先截断单)
 *
 * 返回 { checked, time_fixed, seller_fixed, nick_fixed, removed, skipped_risk, errors[] }。
 */
import { fetchOrderDetail, cookieIdUid } from '../../utils/xianyu/mtop'
import { normalizeCreatedAt } from '../../utils/xianyu/order-sync'
import { persistCookieRotation } from '../../utils/xianyu/cookie-store'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const LIMIT = Math.min(Math.max(Number(body?.limit) || 60, 1), 200)

    const BUDGET_MS = 50_000
    const deadline = Date.now() + BUDGET_MS

    // 候选单: 截断单 (精度丢失形态) 优先, 其次"时间堆积"单 (created_at == updated_at
    // 同秒 = 从未对过账) 与卖家身份为空的订单。按 updated_at 升序 (最老优先)。
    const candidates = await db
      .all<{ order_id: string; cookie_id: string; created_at: string }>(
        `SELECT order_id, cookie_id, created_at FROM orders
         WHERE (order_id LIKE '%0000' OR (created_at = updated_at AND seller_id = '') OR seller_id = '')
         ORDER BY (order_id LIKE '%0000') DESC, updated_at ASC
         LIMIT ?`,
        [LIMIT],
      )
      .catch(() => [])

    if (!candidates.length) {
      return ok({ checked: 0, time_fixed: 0, seller_fixed: 0, nick_fixed: 0, removed: 0, skipped_risk: 0, errors: [] }, '没有需要修复的存量订单')
    }

    // 账号 cookie 缓存 (逐账号只读一次库)
    const cookieCache = new Map<string, string>()
    const loadCookie = async (cookieId: string): Promise<string> => {
      if (cookieCache.has(cookieId)) return cookieCache.get(cookieId) || ''
      const row = await db.get<{ value: string }>('SELECT value FROM cookies WHERE id = ?', [cookieId]).catch(() => null)
      const v = String(row?.value || '')
      cookieCache.set(cookieId, v)
      return v
    }

    let checked = 0
    let timeFixed = 0
    let sellerFixed = 0
    let nickFixed = 0
    let removed = 0
    let skippedRisk = 0
    const errors: string[] = []

    for (const cand of candidates) {
      if (Date.now() > deadline) {
        errors.push(`时间预算耗尽 (${BUDGET_MS / 1000}s), 剩余 ${(candidates.length - checked)} 单未核验, 可再次执行续修`)
        break
      }
      const cookieId = String(cand.cookie_id || '')
      const orderId = String(cand.order_id || '')
      const isTruncated = /0000$/.test(orderId)
      const cookieStr = await loadCookie(cookieId)
      if (!cookieStr) {
        errors.push(`${orderId}: 账号 ${cookieId} Cookie 为空, 跳过`)
        checked++
        continue
      }

      const r = await fetchOrderDetail(cookieStr, orderId)
      if (r.finalCookieStr && r.finalCookieStr !== cookieStr) {
        cookieCache.set(cookieId, r.finalCookieStr)
        await persistCookieRotation(db, cookieId, cookieStr, r.finalCookieStr).catch(() => {})
      }
      checked++

      if (r.detail) {
        // 核验通过: 订单在平台侧真实存在 → 回填 (真实值才写, 绝不伪造)
        const realTime = normalizeCreatedAt(String(r.detail.create_time_text || ''))
        const realSeller = String(r.detail.seller_id || '').trim()
        if (realTime) {
          await db
            .run('UPDATE orders SET created_at = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?', [realTime, orderId])
            .catch(() => {})
          timeFixed++
        }
        // 卖家身份回填 + 隔离复核 (详情身份与账号 uid 不符 = 他人订单, 不删除但打标,
        // 供趋势列表按需过滤 — 不做静默删除, 用户可在订单页自行处置)
        if (realSeller) {
          const expectedUid = cookieIdUid(cookieId)
          if (expectedUid && /^\d+$/.test(realSeller) && realSeller !== expectedUid) {
            await db
              .run('UPDATE orders SET seller_id = ?, sync_source = ? WHERE order_id = ?', [realSeller, 'seller_mismatch', orderId])
              .catch(() => {})
            errors.push(`${orderId}: 详情核验卖家身份 (${realSeller}) 与账号 (${expectedUid}) 不符, 已打标 seller_mismatch`)
          } else {
            await db
              .run('UPDATE orders SET seller_id = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?', [realSeller, orderId])
              .catch(() => {})
            sellerFixed++
          }
        }
        if (String(r.detail.buyer_id || '')) {
          await db
            .run('UPDATE orders SET buyer_id = CASE WHEN buyer_id = "" THEN ? ELSE buyer_id END WHERE order_id = ?', [
              String(r.detail.buyer_id),
              orderId,
            ])
            .catch(() => {})
          nickFixed++
        }
      } else if (isTruncated) {
        // 截断单详情必查不到 (精度丢失的 ID 在平台侧不存在) → 删除 + 屏蔽表登记
        await db.run('DELETE FROM orders WHERE order_id = ?', [orderId]).catch(() => {})
        await db
          .run(
            `INSERT INTO deleted_orders (order_id, cookie_id, reason) VALUES (?, ?, 'truncated_id')
             ON CONFLICT(order_id) DO NOTHING`,
            [orderId, cookieId],
          )
          .catch(() => {})
        removed++
      } else {
        // 非截断单失败: 风控/无权限/系统错误 — 绝不删除 (真实订单零误伤), 只计数
        skippedRisk++
        if (errors.length < 20) errors.push(`${orderId}: 详情查询失败 (${String(r.retMsg || '未知').slice(0, 60)}), 已跳过`)
      }

      await new Promise((resolve) => setTimeout(resolve, 350))
    }

    return ok(
      { checked, time_fixed: timeFixed, seller_fixed: sellerFixed, nick_fixed: nickFixed, removed, skipped_risk: skippedRisk, errors },
      `存量订单修复完成: 核验 ${checked} 单, 回填下单时间 ${timeFixed} 单, 回填卖家 ${sellerFixed} 单, 清理截断脏单 ${removed} 单`,
    )
  }),
)
