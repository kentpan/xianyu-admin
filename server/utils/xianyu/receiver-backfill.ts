/**
 * 收货信息定向补全 (v2.3.5 修复) — 修复「2025-11-06 起新订单缺失收货人/手机号/地址」。
 *
 * 根因 (v2.3.5 定稿, mock 复现实锤):
 *  - v2.3.0 给列表解析加了 seller_id "受限深扫"兜底, 但闲鱼响应各容器里广泛存在
 *    "闲鱼号" (userNumberId, 买家也有) — 深扫扫出买家/他人 uid 后, 账号隔离复核把
 *    「自己的订单」误判为「他人店铺订单」**全部静默拦截** → 列表同步从部署 v2.3.x 起
 *    (11-06 03:57) 全军覆没, 新订单只能靠付款卡片兜底 INSERT 落库 (无收货人/无状态
 *    时间/金额=卡片原价)。截图证据: 缺收货人的订单连发货/完成时间灰字也没有 (状态
 *    时间只能来自列表同步), 铁证列表同步零写入, 非平台字段变动。修复: extractSeller
 *    IdFromItem 回滚 v2.2.7 已知候选语义 (mtop.ts), 并在同步结果里显性上报拦截样例。
 *  - 本补全链路保留: 修复部署前的存量卡片单 (收货字段缺失) + 列表接口未来若真发生
 *    字段变动的兜底通道, 数据源是订单详情接口 addressInfo (权威)。
 *
 * 补全数据源: 订单详情接口 (mtop.idle.web.trade.order.detail, 与订单页「详情精修」/
 * 手动刷新完全同源), addressInfo.receiverName / receiverMobile / fullAddress / city;
 * 顺带用 priceInfo.amount 复核最终成交金额 (非空才写, 与手动刷新同口径 — 列表金额
 * priceVO.totalPrice 与详情金额对账后以详情为准)。
 *
 * 红线 (吸取历史教训 — v2.2.x 时代「逐单详情精修」因批量逐单调详情动辄数百次请求,
 * 是超时/风控元凶, 按用户要求全链路移除):
 *  - 只处理缺失收货信息的订单 (receiver_name / receiver_phone / receiver_address 至少一项为空),
 *    绝不动已齐全的订单;
 *  - 每单最多尝试 3 次 (receiver_attempts 持久化到 orders 列), 平台详情接口也不给的
 *    (虚拟商品无地址/风控拒答) 绝不死循环, 3 次后永久放养;
 *  - 每轮每账号限量 (定时链路 3 单 / 手动补全 20 单), 单账号单轮最多几十次详情调用;
 *  - 候选耗尽后 6 小时 isolate 内存冷却, 冷却期零查询零 API 调用 (不给 D1 读配额添负);
 *  - 取消单 (cancelled) 不补 (交易关闭无发货语义, 白花详情调用)。
 *  - 手动补全 (force) 绕过冷却 — 用户点按钮就是要立刻补。
 */
import { getDb } from '../db'
import { fetchOrderDetail, type MtopTransport } from './mtop'
import { persistCookieRotation } from './cookie-store'

/** 每单最大尝试次数 (持久化, 超过后永久放养 — 平台真不给的绝不死循环) */
export const RECEIVER_BACKFILL_MAX_ATTEMPTS = 3

/** 候选耗尽后的内存冷却时长 (6h) — 冷却期零查询零调用 */
const IDLE_COOLDOWN_MS = 6 * 60 * 60 * 1000

/** isolate 内存冷却时间戳 (进程重启即失效重新扫描一次, 无害) */
let idleUntil = 0

export interface ReceiverBackfillResult {
  /** 本轮取到的候选订单数 */
  scanned: number
  /** 补全成功 (详情接口返回了至少一项收货字段) 的订单数 */
  recovered: number
  /** 实际发起详情调用的订单数 */
  attempted: number
  /** 详情调用失败 (接口报错/无数据) 的订单数 */
  failed: number
  /** 详情返回了数据但收货字段仍全空 (平台侧确实没有) 的订单数 */
  empty: number
  /** 补全后仍缺失收货信息的订单总数 (仅手动补全时统计, -1 = 未统计) */
  remaining: number
  /** 触发了冷却时的截止 ISO 时间 (未触发为 null) */
  cooldownUntil: string | null
}

export interface BackfillOptions {
  /** 可插拔传输通道 (代理任务通道 / 网关透传 / 默认直连), 与手动刷新同构 */
  transport?: MtopTransport
  /** 绕过 6h 空闲冷却 (手动补全按钮用) */
  force?: boolean
  /** 补全后统计剩余缺失数 (手动补全用; 定时链路不统计省一次查询) */
  countRemaining?: boolean
}

/** 单账号缺收货信息的候选查询 (receiver_attempts < 3 防死循环, 取消单不补) */
function candidateQuery(limit: number): string {
  return `SELECT order_id, order_status, receiver_name, receiver_phone, receiver_address, amount
FROM orders
WHERE cookie_id = ?
  AND (receiver_name = '' OR receiver_phone = '' OR IFNULL(receiver_address, '') = '')
  AND receiver_attempts < ${RECEIVER_BACKFILL_MAX_ATTEMPTS}
  AND order_status != 'cancelled'
ORDER BY created_at DESC
LIMIT ${limit}`
}

/**
 * 对单个账号执行一轮收货信息补全。
 * @param db        数据库客户端 (getDb())
 * @param cookieId  账号 id (cookies.id)
 * @param limit     本轮最多处理的订单数 (定时链路 3, 手动补全 20)
 */
export async function backfillReceiverForAccount(
  db: Awaited<ReturnType<typeof getDb>>,
  cookieId: string,
  limit: number,
  opts: BackfillOptions = {},
): Promise<ReceiverBackfillResult> {
  const result: ReceiverBackfillResult = {
    scanned: 0,
    recovered: 0,
    attempted: 0,
    failed: 0,
    empty: 0,
    remaining: -1,
    cooldownUntil: null,
  }

  // 空闲冷却: 上轮已无候选, 6h 内零查询零调用 (手动 force 绕过)
  if (!opts.force && Date.now() < idleUntil) return result

  const rows = await db
    .all<{
      order_id: string
      order_status: string
      receiver_name: string
      receiver_phone: string
      receiver_address: string | null
      amount: string
    }>(candidateQuery(limit), [cookieId])
    .catch(() => [] as { order_id: string }[])

  result.scanned = rows.length
  if (!rows.length) {
    // 本轮无候选 → 进入冷却 (下轮定时触发直接短路, 零查询)
    idleUntil = Date.now() + IDLE_COOLDOWN_MS
    result.cooldownUntil = new Date(idleUntil).toISOString()
    if (opts.countRemaining) {
      result.remaining = 0
    }
    return result
  }

  const acct = await db.get<{ value: string }>('SELECT value FROM cookies WHERE id = ?', [cookieId]).catch(() => null)
  const cookieStr = String(acct?.value || '')
  if (!cookieStr) {
    // Cookie 为空 (账号未登录/已清空) — 不发起详情调用, 也不计尝试 (等重新扫码后自然恢复)
    return result
  }

  let lastCookieStr = cookieStr
  for (const row of rows) {
    result.attempted++
    let r: Awaited<ReturnType<typeof fetchOrderDetail>> | null = null
    try {
      r = await fetchOrderDetail(lastCookieStr, String(row.order_id), { transport: opts.transport })
    } catch {
      r = null
    }
    if (r?.finalCookieStr && r.finalCookieStr !== lastCookieStr) lastCookieStr = r.finalCookieStr

    if (!r?.detail) {
      // 详情调用失败 (风控/Cookie 失效/无数据) — 计一次尝试, 累计 3 次后放养
      await db
        .run('UPDATE orders SET receiver_attempts = receiver_attempts + 1 WHERE order_id = ?', [row.order_id])
        .catch(() => {})
      result.failed++
      continue
    }

    // 详情返回了数据 — 非空字段才写 (与手动刷新同口径, 响应未携带绝不抹掉本地值),
    // 金额用详情 priceInfo.amount 复核 (最终成交金额, 非空才覆盖列表金额)
    const d = r.detail
    const sets: string[] = ['receiver_attempts = receiver_attempts + 1']
    const params: unknown[] = []
    let hit = 0
    const pushField = (col: string, val: string): void => {
      if (val) {
        sets.push(`${col} = ?`)
        params.push(val)
        hit++
      }
    }
    pushField('receiver_name', String(d.receiver_name || ''))
    pushField('receiver_phone', String(d.receiver_phone || ''))
    pushField('receiver_address', String(d.receiver_address || ''))
    pushField('receiver_city', String(d.receiver_city || ''))
    pushField('amount', String(d.price || ''))
    await db.run(`UPDATE orders SET ${sets.join(', ')} WHERE order_id = ?`, [...params, row.order_id]).catch(() => {})

    if (hit > 0) result.recovered++
    else result.empty++
  }

  // 详情调用会轮换 _m_h5_tk 等 Cookie — 回写一次 (与列表同步/手动刷新同源)
  if (lastCookieStr !== cookieStr) {
    await persistCookieRotation(db, cookieId, cookieStr, lastCookieStr).catch(() => {})
  }

  // 候选未用满 = 池子已见底 → 进入冷却
  if (rows.length < limit) {
    idleUntil = Date.now() + IDLE_COOLDOWN_MS
    result.cooldownUntil = new Date(idleUntil).toISOString()
  }

  if (opts.countRemaining) {
    const cnt = await db
      .get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM orders
WHERE cookie_id = ?
  AND (receiver_name = '' OR receiver_phone = '' OR IFNULL(receiver_address, '') = '')
  AND receiver_attempts < ${RECEIVER_BACKFILL_MAX_ATTEMPTS}
  AND order_status != 'cancelled'`,
        [cookieId],
      )
      .catch(() => ({ n: 0 }))
    result.remaining = Number(cnt?.n || 0)
  }

  return result
}

/**
 * 对全部 (或指定) 账号批量补全 — 手动「补全收货信息」按钮的数据通道。
 * 账号逐个串行处理, 单账号单轮最多 limit 单, 全程可预算控制。
 */
export async function backfillReceiverAllAccounts(
  db: Awaited<ReturnType<typeof getDb>>,
  limitPerAccount: number,
  opts: BackfillOptions & { cookieId?: string } = {},
): Promise<ReceiverBackfillResult & { accounts: string[]; errors: string[] }> {
  const accounts = await db
    .all<{ id: string; value: string }>(
      opts.cookieId
        ? "SELECT id, value FROM cookies WHERE value IS NOT NULL AND value != '' AND id = ?"
        : "SELECT id, value FROM cookies WHERE value IS NOT NULL AND value != ''",
      opts.cookieId ? [opts.cookieId] : undefined,
    )
    .catch(() => [] as { id: string; value: string }[])

  const out: ReceiverBackfillResult & { accounts: string[]; errors: string[] } = {
    scanned: 0,
    recovered: 0,
    attempted: 0,
    failed: 0,
    empty: 0,
    remaining: 0,
    cooldownUntil: null,
    accounts: [],
    errors: [],
  }

  for (const acct of accounts) {
    try {
      const r = await backfillReceiverForAccount(db, String(acct.id), limitPerAccount, {
        transport: opts.transport,
        force: true,
        countRemaining: true,
      })
      out.scanned += r.scanned
      out.recovered += r.recovered
      out.attempted += r.attempted
      out.failed += r.failed
      out.empty += r.empty
      if (r.remaining >= 0) out.remaining += r.remaining
      out.accounts.push(String(acct.id))
    } catch (e: any) {
      out.errors.push(`${acct.id}: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  return out
}
