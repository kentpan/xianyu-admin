/**
 * POST /api/orders/refresh — 一键同步订单 (列表拉取 + 详情精修)。
 * Body: { cookie_id?: string, status?: string }
 *
 * 第一步: 按账号拉取闲鱼卖家已售订单列表 (mtop.taobao.idle.trade.merchant.sold.get,
 *         queryCode=ALL, 最多 5 页/150 单), 全部状态订单 upsert 入库 —
 *         交易卡片丢失/解析失败时 "已付款待发货" 订单也能从这里补齐 (用户核心数据)。
 * 第二步: 对本地非终态订单 (pending_ship/processing/refunding/unknown) 逐单调
 *         mtop.idle.web.trade.order.detail 精修 (规格/城市等列表接口不含的字段),
 *         每单间隔 300ms 防风控。
 *
 * 返回 { total, updated, no_change, failed, results[], list_sync: { inserted, updated, accounts, errors[] } },
 * 失败单据如实携带错误信息。
 */
import { fetchOrderDetail, fetchSellerOrders } from '../../utils/xianyu/mtop'
import { upsertSoldOrders } from '../../utils/xianyu/order-sync'
import { fetchOrdersViaProxy, isProxyEngineMode } from '../../utils/xianyu/order-task'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const cookieFilter = String(body?.cookie_id || '').trim()
    const statusFilter = String(body?.status || '').trim()

    /* ---- 第一步: 订单列表拉取 (全部状态, 含已付款待发货) ---- */
    const accounts = cookieFilter
      ? await db.all<{ id: string; value: string }>('SELECT id, value FROM cookies WHERE id = ?', [cookieFilter]).catch(() => [])
      : await db
          .all<{ id: string; value: string }>("SELECT id, value FROM cookies WHERE value IS NOT NULL AND value != ''")
          .catch(() => [])

    let listInserted = 0
    let listUpdated = 0
    const listErrors: string[] = []
    const MAX_LIST_PAGES = 5

    /* ---- 第一步分流: 独立代理模式 → 任务通道 (CF 出口到 h5api 被墙, 直连必 500);
     *      内置引擎 → 本机直连 (原语义) ---- */
    const proxyMode = await isProxyEngineMode(db)

    if (proxyMode) {
      // 各账号并行下发任务, 统一等待代理回报 (每账号一任务, 代理串行逐账号执行)
      const TIMEOUT_MS = 20_000
      const settled = await Promise.all(
        accounts.map(async (acct) => ({ acct, r: await fetchOrdersViaProxy(db, String(acct.id), { queryCode: 'ALL', pages: MAX_LIST_PAGES, timeoutMs: TIMEOUT_MS }) })),
      )
      for (const { acct, r } of settled) {
        if (r.errors.length) listErrors.push(`${acct.id}: ${r.errors.join('; ').slice(0, 200)}`)
        if (r.items.length) {
          const ur = await upsertSoldOrders(db, String(acct.id), r.items)
          listInserted += ur.inserted
          listUpdated += ur.updated
        }
      }
    } else {
      for (const acct of accounts) {
        let cookieStr = String(acct.value || '')
        let page = 1
        while (page <= MAX_LIST_PAGES) {
          const pg = await fetchSellerOrders(cookieStr, page, 'ALL')
          if (pg.finalCookieStr && pg.finalCookieStr !== cookieStr) {
            cookieStr = pg.finalCookieStr
            await db.run('UPDATE cookies SET value = ? WHERE id = ?', [cookieStr, acct.id]).catch(() => {})
          }
          if (pg.retMsg) {
            listErrors.push(`${acct.id}: ${pg.retMsg.slice(0, 120)}`)
            break
          }
          if (pg.items.length) {
            const r = await upsertSoldOrders(db, String(acct.id), pg.items)
            listInserted += r.inserted
            listUpdated += r.updated
          }
          if (!pg.nextPage || !pg.items.length) break
          page++
          await new Promise((r) => setTimeout(r, 400))
        }
      }
    }

    /* ---- 第二步: 非终态订单详情精修 (规格/城市等列表接口不含的字段) ----
     * 独立代理模式跳过: 详情接口同为 h5api 直连 (CF 被墙), 逐单任务等待在请求预算内
     * 不可能完成; 列表接口已含 状态/金额/买家/收货人 核心字段, 满足订单管理页展示 ---- */
    const rows = proxyMode
      ? []
      : await db.all<any>(
          `SELECT o.order_id, o.cookie_id, o.order_status FROM orders o
           WHERE o.order_status IN ('pending_ship', 'processing', 'refunding', 'unknown')
              OR o.order_status IS NULL OR o.order_status = ''
           ${cookieFilter ? 'AND o.cookie_id = ?' : ''}
           ORDER BY o.updated_at DESC LIMIT 200`,
          cookieFilter ? [cookieFilter] : [],
        )
    const targets = rows.filter((r) => !statusFilter || String(r.order_status || 'unknown') === statusFilter)

    const cookieCache = new Map<string, string>()
    const results: { order_id: string; changed: boolean; error?: string }[] = []
    let updated = 0
    let noChange = 0
    let failed = 0

    for (const t of targets) {
      const orderId = String(t.order_id)
      const cookieId = String(t.cookie_id || '')
      try {
        let cookieStr = cookieCache.get(cookieId) || ''
        if (!cookieStr) {
          const acct = await db.get<any>('SELECT value FROM cookies WHERE id = ?', [cookieId])
          if (!acct?.value) throw new Error(`账号 ${cookieId} 不存在或 Cookie 为空`)
          cookieStr = acct.value
          cookieCache.set(cookieId, cookieStr)
        }

        const { detail, retMsg, finalCookieStr } = await fetchOrderDetail(cookieStr, orderId)
        if (finalCookieStr && finalCookieStr !== cookieStr) {
          cookieCache.set(cookieId, finalCookieStr)
          await db.run('UPDATE cookies SET value = ? WHERE id = ?', [finalCookieStr, cookieId])
        }
        if (!detail) throw new Error(retMsg || '闲鱼接口未返回订单数据')

        const sets: string[] = []
        const params: unknown[] = []
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
        sets.push('updated_at = CURRENT_TIMESTAMP')
        await db.run(`UPDATE orders SET ${sets.join(', ')} WHERE order_id = ?`, [...params, orderId])

        const changed = detail.order_status !== String(t.order_status || 'unknown')
        if (changed) updated++
        else noChange++
        results.push({ order_id: orderId, changed })
      } catch (e: any) {
        failed++
        results.push({ order_id: orderId, changed: false, error: String(e?.message || e) })
      }
      // 单间间隔防风控
      await new Promise((r) => setTimeout(r, 300))
    }

    return ok(
      {
        total: targets.length,
        updated,
        no_change: noChange,
        failed,
        results,
        list_sync: {
          inserted: listInserted,
          updated: listUpdated,
          accounts: accounts.length,
          errors: listErrors,
          mode: proxyMode ? 'proxy' : 'direct',
          detail_refine: proxyMode ? 'skipped (代理模式: 详情接口 CF 不可直连, 列表字段已含核心数据)' : 'executed',
        },
      },
      listInserted || listUpdated ? `订单列表已同步: 新拉取 ${listInserted} 单, 更新 ${listUpdated} 单` : '订单列表已同步',
    )
  }),
)
