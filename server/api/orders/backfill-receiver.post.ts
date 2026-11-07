/**
 * POST /api/orders/backfill-receiver — 一键补全缺失的收货人/手机号/地址 (v2.3.5 修复)。
 * Body: { cookie_id?: string, limit?: number }
 *
 * 背景: 闲鱼卖家订单列表接口 (mtop.taobao.idle.trade.merchant.sold.get) 自
 * 2025-11-06 起不再在 buyerInfoVO 里返回买家姓名/手机/收货地址 (平台隐私收紧),
 * 11-06 后同步的订单收货人三字段全空 — 同步代码零改动, 是平台侧变化。
 *
 * 本端点走订单详情接口 (mtop.idle.web.trade.order.detail, 与单条「详情精修」/手动
 * 刷新完全同源) 对缺失收货信息的订单定向补全:
 *  - 只补 receiver_name/phone/address/city + 金额复核 (priceInfo.amount, 非空才写);
 *  - 每单最多尝试 3 次 (receiver_attempts 持久化), 平台详情接口也不给的绝不死循环;
 *  - 每账号单次默认最多 20 单 (limit 可调, 上限 50), 绝不批量轰炸 (详情接口自带
 *    2.5s 瞬时限流重试);
 *  - 取消单不补 (交易关闭无发货语义);
 *  - 传输分流与一键同步同源: 透传网关优先 (mtopFetch 自动转发) → 代理任务通道兜底
 *    → 内置引擎/本地直连。
 *
 * 返回 { accounts, scanned, recovered, attempted, failed, empty, remaining, errors[] }。
 * 一次补不完 (remaining > 0) 再点一次即可, 每次恢复一批直到补完或平台侧确实没有。
 */
import { isProxyEngineMode, taskChannelTransport } from '../../utils/xianyu/order-task'
import { isGatewayMode } from '../../utils/xianyu/gateway'
import { backfillReceiverAllAccounts } from '../../utils/xianyu/receiver-backfill'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const body = await readBody(event).catch(() => ({}))
    const cookieFilter = String(body?.cookie_id || '').trim()
    const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 50)

    /* ---- 传输分流 (与 orders/refresh 同源): 网关透传/直连 → 默认 mtopFetch;
     *      代理模式且网关不可达 → 任务通道 (代理主动外呼, 无需公网入站) ---- */
    const proxyMode = await isProxyEngineMode(db)
    const gwMode = await isGatewayMode(db)
    const transport = proxyMode && !gwMode ? taskChannelTransport(db, 15_000) : undefined

    const r = await backfillReceiverAllAccounts(db, limit, {
      transport,
      cookieId: cookieFilter || undefined,
    })

    const parts: string[] = [`恢复 ${r.recovered} 单收货信息`]
    if (r.empty > 0) parts.push(`${r.empty} 单平台未返回收货字段`)
    if (r.failed > 0) parts.push(`${r.failed} 单详情查询失败 (稍后可再试)`)
    if (r.remaining > 0) parts.push(`仍缺 ${r.remaining} 单 (再点一次继续补)`)
    if (r.recovered === 0 && r.empty === 0 && r.failed === 0) parts.push('没有需要补全的订单')

    return ok(
      {
        accounts: r.accounts,
        scanned: r.scanned,
        recovered: r.recovered,
        attempted: r.attempted,
        failed: r.failed,
        empty: r.empty,
        remaining: r.remaining,
        errors: r.errors,
      },
      parts.join(', '),
    )
  }),
)
