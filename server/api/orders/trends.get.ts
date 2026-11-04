/**
 * GET /api/orders/trends — 闲鱼趋势 (订单管理页「闲鱼趋势」tab 数据源)。
 *
 * 返回三块真实数据 (全部来自 orders 表, 绝无假数据):
 *   1. days[]       — 近 7 天 (含今日) 全部账号订单按天趋势: 订单量 + 收入 + 三指标当日计数
 *   2. metrics      — 核心订单指标 (全库累计 + 近7天): 已付款 / 已收货 / 已退款 / 订单总数
 *   3. other_total  — 非已添加账号的订单总数 (趋势 tab 分页列表的总数提示)
 *
 * 指标口径 (与 SELLER_ORDER_STATUS_MAP 语义对齐, 基于库内 order_status 真实值):
 *   已付款 paid     = pending_ship / shipped / completed / refunding / refunded / processing
 *                     (待发货及之后的所有状态都意味着买家已完成付款; 待付款/已取消/未知不计)
 *   已收货 received = completed (交易成功)
 *   已退款 refunded = refunding / refunded
 *
 * 环境自适应 (node+sqlite 与 edge+kv/d1 双环境完整展现):
 *   - sqlite / d1 同属 SQLite 方言: substr 分组 + date('now',...) 窗口一次聚合
 *   - mysql / memory 等其它驱动: SQL 方言不受支持时 catch 回退全表扫描 + JS 聚合
 *     (与 dashboard/trend.get.ts 同款兜底模式, 数据语义完全一致)
 */

/** 已付款口径的状态集合 (order_status 实际取值, 见 mtop.ts SELLER_ORDER_STATUS_MAP) */
const PAID_STATUSES = ['pending_ship', 'shipped', 'completed', 'refunding', 'refunded', 'processing']
const RECEIVED_STATUSES = ['completed']
const REFUNDED_STATUSES = ['refunding', 'refunded']

interface DayBucket {
  date: string
  label: string
  count: number
  revenue: number
  paid: number
  received: number
  refunded: number
}

function emptyDayBuckets(): DayBucket[] {
  const days: DayBucket[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10) // YYYY-MM-DD (与 created_at 的 UTC 存储对齐)
    days.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0, revenue: 0, paid: 0, received: 0, refunded: 0 })
  }
  return days
}

function metricOf(status: string | null | undefined): 'paid' | 'received' | 'refunded' | null {
  const s = String(status || '')
  if (PAID_STATUSES.includes(s)) {
    if (RECEIVED_STATUSES.includes(s)) return 'received'
    if (REFUNDED_STATUSES.includes(s)) return 'refunded'
    return 'paid'
  }
  return null
}

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const days = emptyDayBuckets()
    const dayIndex = new Map(days.map((d) => [d.date, d]))

    /* ---- 近 7 天按天聚合 ---- */
    try {
      const rows = await db.all<{
        d: string
        c: number
        rev: number
        paid: number
        received: number
        refunded: number
      }>(
        `SELECT substr(created_at, 1, 10) as d,
                COUNT(*) as c,
                COALESCE(SUM(CAST(amount AS REAL)), 0) as rev,
                COALESCE(SUM(CASE WHEN order_status IN (${PAID_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END), 0) as paid,
                COALESCE(SUM(CASE WHEN order_status IN (${RECEIVED_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END), 0) as received,
                COALESCE(SUM(CASE WHEN order_status IN (${REFUNDED_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END), 0) as refunded
         FROM orders
         WHERE created_at >= date('now', '-7 days')
         GROUP BY substr(created_at, 1, 10)`,
        [...PAID_STATUSES, ...RECEIVED_STATUSES, ...REFUNDED_STATUSES],
      )
      for (const r of rows) {
        const day = dayIndex.get(r.d)
        if (!day) continue
        day.count = Number(r.c) || 0
        day.revenue = Math.round((Number(r.rev) || 0) * 100) / 100
        day.paid = Number(r.paid) || 0
        day.received = Number(r.received) || 0
        day.refunded = Number(r.refunded) || 0
      }
    } catch {
      // 方言不兼容 (mysql/memory 等) → 全表扫描 JS 聚合, 语义与 SQL 分支完全一致
      const all = await db.all<{ created_at: string; amount: string; order_status: string }>(
        'SELECT created_at, amount, order_status FROM orders',
      )
      for (const o of all) {
        const d = (o.created_at || '').slice(0, 10)
        const day = dayIndex.get(d)
        if (!day) continue
        day.count++
        day.revenue += Number(o.amount) || 0
        const m = metricOf(o.order_status)
        if (m === 'paid') day.paid++
        else if (m === 'received') day.received++
        else if (m === 'refunded') day.refunded++
      }
      for (const day of days) day.revenue = Math.round(day.revenue * 100) / 100
    }

    /* ---- 核心指标全库累计 ---- */
    let totals = { all: 0, paid: 0, received: 0, refunded: 0 }
    try {
      const t = await db.get<{ all: number; paid: number; received: number; refunded: number }>(
        `SELECT COUNT(*) as all_cnt,
                COALESCE(SUM(CASE WHEN order_status IN (${PAID_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END), 0) as paid_cnt,
                COALESCE(SUM(CASE WHEN order_status IN (${RECEIVED_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END), 0) as received_cnt,
                COALESCE(SUM(CASE WHEN order_status IN (${REFUNDED_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END), 0) as refunded_cnt
         FROM orders`,
        [...PAID_STATUSES, ...RECEIVED_STATUSES, ...REFUNDED_STATUSES],
      )
      totals = {
        all: Number(t?.all_cnt) || 0,
        paid: Number(t?.paid_cnt) || 0,
        received: Number(t?.received_cnt) || 0,
        refunded: Number(t?.refunded_cnt) || 0,
      }
    } catch {
      const all = await db.all<{ order_status: string }>('SELECT order_status FROM orders')
      totals.all = all.length
      for (const o of all) {
        const m = metricOf(o.order_status)
        if (m === 'paid') totals.paid++
        else if (m === 'received') totals.received++
        else if (m === 'refunded') totals.refunded++
      }
    }

    /* ---- 全量订单总数 (趋势 tab 分页列表) ----
     * (v2.2.7) 口径与 GET /api/orders?scope=full 完全一致:
     *   全量订单同步链路拉取入库的订单 (sync_source='full_sync', 所有状态)
     *   ∪ 非已添加账号的历史订单 (cookie_id 为空或不在 cookies 表, 含已删除账号) */
    let otherTotal = 0
    try {
      const t = await db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM orders
         WHERE sync_source = 'full_sync'
            OR cookie_id IS NULL OR cookie_id = ''
            OR cookie_id NOT IN (SELECT id FROM cookies)`,
      )
      otherTotal = Number(t?.c) || 0
    } catch {
      // 方言不兼容 (mysql/memory 等) → 全表扫描 JS 聚合, 口径与 SQL 分支完全一致
      // (sync_source 列缺失属部署异常: 此处 SELECT 仍会抛错 → 接口显性报错, 不静默给 0)
      const [all, cookieRows] = await Promise.all([
        db.all<{ cookie_id: string; sync_source: string }>('SELECT cookie_id, sync_source FROM orders'),
        db.all<{ id: string }>('SELECT id FROM cookies'),
      ])
      const known = new Set(cookieRows.map((c) => String(c.id)))
      otherTotal = all.filter((r) => {
        if (String(r.sync_source || '') === 'full_sync') return true
        const cid = String(r.cookie_id || '')
        return !cid || !known.has(cid)
      }).length
    }

    return ok({
      days,
      metrics: {
        totals,
        week: {
          all: days.reduce((s, d) => s + d.count, 0),
          paid: days.reduce((s, d) => s + d.paid, 0),
          received: days.reduce((s, d) => s + d.received, 0),
          refunded: days.reduce((s, d) => s + d.refunded, 0),
          revenue: Math.round(days.reduce((s, d) => s + d.revenue, 0) * 100) / 100,
        },
      },
      other_total: otherTotal,
    })
  }),
)
