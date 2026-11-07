/**
 * POST /api/orders/refresh — 获取最新的订单列表 (纯列表同步, 无逐单详情精修)。
 * Body: { cookie_id?: string }
 *
 * 按账号拉取闲鱼卖家已售订单列表 (mtop.taobao.idle.trade.merchant.sold.get,
 * queryCode=ALL, 最多 5 页/150 单), 全部状态订单 upsert 入库 — 含待发货/已发货/
 * 已完成/已取消, created_at 用闲鱼返回的真实下单时间。
 *
 * 历史: 旧版第二步会对非终态订单逐单调 order.detail "精修" (50~200 单 × 500ms+),
 * 是一键同步动辄数十秒超时的元凶。按需求详情精修能力已全链路移除,
 * 本接口只做列表同步, 秒级返回。
 *
 * 返回 { inserted, updated, blocked, skipped_deleted, accounts, mode, elapsed_ms, errors[] }。
 */
import { fetchSellerOrders, cookieIdentityMismatch } from '../../utils/xianyu/mtop'
import { persistCookieRotation } from '../../utils/xianyu/cookie-store'
import { upsertSoldOrders } from '../../utils/xianyu/order-sync'
import { fetchOrdersViaProxy, isProxyEngineMode } from '../../utils/xianyu/order-task'
import { isGatewayMode } from '../../utils/xianyu/gateway'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const cookieFilter = String(body?.cookie_id || '').trim()

    const accounts = cookieFilter
      ? await db.all<{ id: string; value: string }>('SELECT id, value FROM cookies WHERE id = ?', [cookieFilter]).catch(() => [])
      : await db
          .all<{ id: string; value: string }>("SELECT id, value FROM cookies WHERE value IS NOT NULL AND value != ''")
          .catch(() => [])

    let listInserted = 0
    let listUpdated = 0
    let listBlocked = 0
    let listSkippedDeleted = 0
    const listErrors: string[] = []
    const listBlockedSamples: string[] = []
    const MAX_LIST_PAGES = 5

    /* ---- 全局时间预算闸门: 同步接口必须在请求预算内完成并如实返回 ----
     * 到点如实返回已拉到的部分 + 显性错误, 绝不无限等。 */
    const REFRESH_BUDGET_MS = 55_000
    const deadline = Date.now() + REFRESH_BUDGET_MS
    const remainMs = () => deadline - Date.now()

    /* ---- 分流: 独立代理模式 → ① 透传网关优先 (引擎登记了公网 IP:端口, CF 直连代理
     *      转发 mtop, 秒级直返) → ② 任务通道兜底 (网关未登记/不可达); 内置引擎 → 本机直连 ---- */
    const proxyMode = await isProxyEngineMode(db)
    const gwMode = await isGatewayMode(db)

    if (proxyMode || gwMode) {
      for (const acct of accounts) {
        if (remainMs() < 5_000) {
          listErrors.push(`整体时间预算耗尽 (${REFRESH_BUDGET_MS / 1000}s), 未拉取的账号已跳过: ${acct.id}`)
          break
        }
        // 会话身份校验: Cookie unb 与账号 id 不符 = 串号 (Cookie 属于其他账号会话),
        // 拉回来的将是他人店铺订单 — 显性报错拦截, 绝不入库
        const mismatch = cookieIdentityMismatch(String(acct.id), String(acct.value || ''))
        if (mismatch) {
          listErrors.push(`${acct.id}: ${mismatch}`)
          continue
        }
        let done = false
        // ① 透传网关优先: mtopFetch 内部自动把请求转发给代理网关 (sign/cookie 轮换仍在后台完成)
        if (gwMode) {
          try {
            let cookieStr = String(acct.value || '')
            let page = 1
            while (page <= MAX_LIST_PAGES) {
              if (remainMs() < 4_000) {
                listErrors.push(`${acct.id}: 整体时间预算耗尽, 第 ${page} 页起未拉取`)
                break
              }
              const pg = await fetchSellerOrders(cookieStr, page, 'ALL')
              if (pg.finalCookieStr && pg.finalCookieStr !== cookieStr) {
                const base = cookieStr
                cookieStr = pg.finalCookieStr
                await persistCookieRotation(db, String(acct.id), base, cookieStr)
              }
              if (pg.retMsg) {
                listErrors.push(`${acct.id}: ${pg.retMsg.slice(0, 120)}`)
                break
              }
              if (pg.items.length) {
                const r = await upsertSoldOrders(db, String(acct.id), pg.items)
                listInserted += r.inserted
                listUpdated += r.updated
                listBlocked += r.blocked
                for (const s of r.blockedSamples || []) if (!listBlockedSamples.includes(s) && listBlockedSamples.length < 5) listBlockedSamples.push(s)
                listSkippedDeleted += r.skippedDeleted
              }
              if (!pg.nextPage || !pg.items.length) break
              page++
              await new Promise((r) => setTimeout(r, 400))
            }
            done = true
          } catch (e: any) {
            listErrors.push(`${acct.id}: 网关透传失败 → 回退任务通道 (${String(e?.message || e).slice(0, 120)})`)
          }
        }
        // ② 任务通道兜底 (代理主动外呼后台, 无需公网入站; 网关未登记或不可达时唯一通路)
        if (!done && proxyMode) {
          const r = await fetchOrdersViaProxy(db, String(acct.id), {
            queryCode: 'ALL',
            pages: MAX_LIST_PAGES,
            timeoutMs: Math.min(20_000, Math.max(3_000, remainMs())),
          })
          if (r.errors.length) listErrors.push(`${acct.id}: ${r.errors.join('; ').slice(0, 200)}`)
          if (r.items.length) {
            const ur = await upsertSoldOrders(db, String(acct.id), r.items)
            listInserted += ur.inserted
            listUpdated += ur.updated
            listBlocked += ur.blocked
            for (const s of ur.blockedSamples || []) if (!listBlockedSamples.includes(s) && listBlockedSamples.length < 5) listBlockedSamples.push(s)
            listSkippedDeleted += ur.skippedDeleted
          }
        }
      }
    } else {
      for (const acct of accounts) {
        if (remainMs() < 4_000) {
          listErrors.push(`整体时间预算耗尽 (${REFRESH_BUDGET_MS / 1000}s), 未拉取的账号已跳过: ${acct.id}`)
          break
        }
        // 会话身份校验 (同上): 防串号 Cookie 静默拉入他人订单
        const mismatch = cookieIdentityMismatch(String(acct.id), String(acct.value || ''))
        if (mismatch) {
          listErrors.push(`${acct.id}: ${mismatch}`)
          continue
        }
        let cookieStr = String(acct.value || '')
        let page = 1
        while (page <= MAX_LIST_PAGES) {
          if (remainMs() < 4_000) {
            listErrors.push(`${acct.id}: 整体时间预算耗尽, 第 ${page} 页起未拉取`)
            break
          }
          const pg = await fetchSellerOrders(cookieStr, page, 'ALL')
          if (pg.finalCookieStr && pg.finalCookieStr !== cookieStr) {
            const base = cookieStr
            cookieStr = pg.finalCookieStr
            await persistCookieRotation(db, String(acct.id), base, cookieStr)
          }
          if (pg.retMsg) {
            listErrors.push(`${acct.id}: ${pg.retMsg.slice(0, 120)}`)
            break
          }
          if (pg.items.length) {
            const r = await upsertSoldOrders(db, String(acct.id), pg.items)
            listInserted += r.inserted
            listUpdated += r.updated
            listBlocked += r.blocked
            for (const s of r.blockedSamples || []) if (!listBlockedSamples.includes(s) && listBlockedSamples.length < 5) listBlockedSamples.push(s)
            listSkippedDeleted += r.skippedDeleted
          }
          if (!pg.nextPage || !pg.items.length) break
          page++
          await new Promise((r) => setTimeout(r, 400))
        }
      }
    }

    if (listBlocked > 0) {
      const samples = listBlockedSamples.length ? `, 样例: ${listBlockedSamples.join(' / ')}` : ''
      listErrors.push(
        `账号隔离: 拦截 ${listBlocked} 条订单 (响应中卖家身份与账号 uid 不符, 未入库${samples})。若是本人订单被误拦, 请检查账号 Cookie 是否串号或反馈给开发者`,
      )
    }
    if (listSkippedDeleted > 0) {
      listErrors.push(`已删除屏蔽: 跳过 ${listSkippedDeleted} 条曾手动删除的订单 (不再拉回)`)
    }

    return ok(
      {
        inserted: listInserted,
        updated: listUpdated,
        blocked: listBlocked,
        skipped_deleted: listSkippedDeleted,
        accounts: accounts.length,
        errors: listErrors,
        mode: gwMode ? 'gateway' : proxyMode ? 'proxy' : 'direct',
        elapsed_ms: REFRESH_BUDGET_MS - remainMs(),
      },
      listInserted || listUpdated ? `已获取最新订单列表: 新拉取 ${listInserted} 单, 更新 ${listUpdated} 单` : '已获取最新订单列表',
    )
  }),
)
