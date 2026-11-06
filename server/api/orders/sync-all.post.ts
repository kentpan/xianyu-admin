/**
 * POST /api/orders/sync-all — 全量订单同步 (v2.2.6, 订单管理「闲鱼趋势」tab 数据源)。
 * Body: { pages?: number }
 *
 * 2.1.7 订单拉取链路的独立移植 (作为全新功能, 与既有 /api/orders/refresh 完全并存互不影响):
 *   - 按账号 Cookie 拉闲鱼卖家已售订单列表 (mtop.taobao.idle.trade.merchant.sold.get,
 *     queryCode=ALL 全部状态, 最多 5 页/150 单, 页间 400ms 限速)
 *   - 不判断区分账号获取全量订单: 无 Cookie 会话身份校验、无账号隔离拦截 —
 *     拉到的全部订单原样入库 (2.1.7 全量语义), 商品名称/买家昵称/卖家身份随单真实落库
 *   - 分流与既有链路一致: 独立代理模式 → http_fetch 任务纯透传 (后台构造并签名的
 *     请求代理原样转发, 原始响应回后台经 fetchSellerOrdersFull 完整解析 — 解析主权
 *     100% 在服务端, 代理零解析); 内置引擎/网关模式 → 服务端直连 (网关自动优先透传)
 *
 * 返回 { inserted, updated, skipped_deleted, accounts, mode, elapsed_ms, errors[] }。
 */
import { fetchSellerOrdersFull } from '../../utils/xianyu/mtop'
import { persistCookieRotation } from '../../utils/xianyu/cookie-store'
import { upsertSoldOrdersFull } from '../../utils/xianyu/order-sync'
import { fetchOrdersFullViaProxy, isProxySyncChannelReady } from '../../utils/xianyu/order-task'
import { isGatewayMode } from '../../utils/xianyu/gateway'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const MAX_PAGES = Math.min(Math.max(Number(body?.pages) || 5, 1), 5)

    // 全部已添加账号 (Cookie 非空): 全量同步以账号 Cookie 为拉取凭证, 但不校验账号归属
    const accounts = await db
      .all<{ id: string; value: string }>("SELECT id, value FROM cookies WHERE value IS NOT NULL AND value != ''")
      .catch(() => [])

    let inserted = 0
    let updated = 0
    let skippedDeleted = 0
    const errors: string[] = []

    // 全局时间预算闸门: 到点如实返回已拉到的部分 + 显性错误, 绝不无限等
    const SYNC_BUDGET_MS = 55_000
    const deadline = Date.now() + SYNC_BUDGET_MS
    const remainMs = () => deadline - Date.now()

    // 分流 (v2.2.7): 独立代理模式 → http_fetch 纯透传 (仅「启用且活跃」的代理, 停用代理的
    // 任务领取一律 403, 走它只会逐页超时); 否则服务端直连拉取 (网关已登记时自动优先透传)
    const proxyMode = await isProxySyncChannelReady(db)
    const gwMode = await isGatewayMode(db)

    for (const acct of accounts) {
      if (remainMs() < 4_000) {
        errors.push(`整体时间预算耗尽 (${SYNC_BUDGET_MS / 1000}s), 未拉取的账号已跳过: ${acct.id}`)
        break
      }
      let cookieStr = String(acct.value || '')
      if (proxyMode) {
        // 代理模式: 后台构造签名请求经 http_fetch 任务透传, 原始响应回后台完整解析
        // (与直连/网关同一套服务端解析层 — 解析主权收归后台, 代理零解析), 全量入库不判断账号
        const r = await fetchOrdersFullViaProxy(db, String(acct.id), {
          pages: MAX_PAGES,
          timeoutMs: Math.min(20_000, Math.max(3_000, remainMs())),
        })
        if (r.errors.length) errors.push(`${acct.id}: ${r.errors.join('; ').slice(0, 200)}`)
        if (r.items.length) {
          const ur = await upsertSoldOrdersFull(db, String(acct.id), r.items)
          inserted += ur.inserted
          updated += ur.updated
          skippedDeleted += ur.skippedDeleted
          // (v2.2.7) 落库失败明细显性透出 — 绝不静默吞错/虚报计数
          for (const msg of ur.errors) errors.push(`${acct.id}: ${msg}`)
        }
        continue
      }
      // 直连/网关模式: 服务端拉取 + 完整解析 (网关已登记时 mtopFetch 自动优先透传)
      let page = 1
      while (page <= MAX_PAGES) {
        if (remainMs() < 4_000) {
          errors.push(`${acct.id}: 整体时间预算耗尽, 第 ${page} 页起未拉取`)
          break
        }
        const pg = await fetchSellerOrdersFull(cookieStr, page, 'ALL')
        if (pg.finalCookieStr && pg.finalCookieStr !== cookieStr) {
          const base = cookieStr
          cookieStr = pg.finalCookieStr
          await persistCookieRotation(db, String(acct.id), base, cookieStr)
        }
        if (pg.retMsg) {
          errors.push(`${acct.id}: ${pg.retMsg.slice(0, 120)}`)
          break
        }
        if (pg.items.length) {
          const r = await upsertSoldOrdersFull(db, String(acct.id), pg.items)
          inserted += r.inserted
          updated += r.updated
          skippedDeleted += r.skippedDeleted
          // (v2.2.7) 落库失败明细显性透出 — 绝不静默吞错/虚报计数
          for (const msg of r.errors) errors.push(`${acct.id}: ${msg}`)
        }
        if (!pg.nextPage || !pg.items.length) break
        page++
        await new Promise((r) => setTimeout(r, 400))
      }
    }

    if (skippedDeleted > 0) {
      errors.push(`已删除屏蔽: 跳过 ${skippedDeleted} 条曾手动删除的订单 (不再拉回)`)
    }

    // (v2.3.0) 存量全量标记回填: v2.2.6 起的存量订单首次插入时未打 full_sync 标
    // (旧版只在 ON CONFLICT 更新分支打标), 导致趋势 tab 全量口径查不到 —
    // 每次全量同步后把已添加账号的无标记订单统一纳入全量口径 (幂等, 影响面=零标记单)
    try {
      await db.run(
        `UPDATE orders SET sync_source = 'full_sync'
         WHERE sync_source = '' AND cookie_id IN (SELECT id FROM cookies)`,
      )
    } catch (e: any) {
      errors.push(`存量全量标记回填失败: ${String(e?.message || e).slice(0, 100)}`)
    }

    return ok(
      {
        inserted,
        updated,
        skipped_deleted: skippedDeleted,
        accounts: accounts.length,
        errors,
        mode: proxyMode ? 'proxy' : gwMode ? 'gateway' : 'direct',
        elapsed_ms: SYNC_BUDGET_MS - remainMs(),
      },
      inserted || updated ? `全量订单同步完成: 新拉取 ${inserted} 单, 更新 ${updated} 单` : '全量订单同步完成',
    )
  }),
)
