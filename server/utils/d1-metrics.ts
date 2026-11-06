/**
 * D1 Metrics — 数据库读写行数计量 (v2.3.5「D1 免费额度保卫战」核心)
 *
 * 背景: Cloudflare D1 免费层每日限额 (UTC 午夜重置) — 行读 5,000,000 / 行写
 * 100,000, 超限当天所有查询直接 500 (D1_ERROR: exceeded daily row read limit)。
 * 本模块给统一 DB 适配层装上「电表」, 让用量在 dashboard 上作为核心指标可见:
 *
 *   1. 抄表 — 每条 SQL 执行后从 D1 meta.rows_read / meta.rows_written 精确累计
 *      (Cloudflare 官方配额口径即此二值; sqlite 驱动无 meta, 行读记 0 / 行写抄
 *      changes 近似值, 计量行为一致但数字含义按驱动区分)
 *   2. 实时视图 — isolate 内存聚合 (本实例启动以来累计 + 待落账增量) +
 *      高消耗 SQL Top-N 排行 (按行读排序, 容量封顶 40 条, 淘汰最便宜条目)
 *   3. 落账 — 节流 60s 把增量原子 UPSERT 进 d1_metrics 表 (UTC 日期为主键,
 *      一天一行, INSERT..ON CONFLICT 永不读改写): dashboard 计量端点强制
 *      flush 后读表, 写路径 (run/exec) 顺带节流落账 — 跨 isolate 的全局日
 *      累计 = 表内值, 引擎 isolate 不经过 dashboard 也能在写库时落账
 *
 * 计量自馈保护: SQL 命中 d1_metrics 表自身的读写一律不计入 (电表不给电表充电)。
 * 落账失败的增量归还待落账池, 下个周期重试, 绝不丢账也不重复计数。
 */
import type { DatabaseAdapter } from './db'

/** D1 免费层每日行读限额 (官方 limits 文档, UTC 午夜重置) */
export const D1_FREE_READ_LIMIT = 5_000_000
/** D1 免费层每日行写限额 */
export const D1_FREE_WRITE_LIMIT = 100_000
/** 落账节流窗口: 每 isolate 至多 60s 一次 UPSERT (≤1440 行写/天/isolate) */
export const D1_METRICS_FLUSH_MS = 60_000

interface QueryStat {
  sql: string
  count: number
  rowsRead: number
  rowsWritten: number
  lastAt: number
}

export interface D1LiveMetrics {
  rowsRead: number
  rowsWritten: number
  queryCount: number
  bootAt: number
  lastFlushAt: number
  pendingReads: number
  pendingWrites: number
  pendingQueries: number
  topQueries: QueryStat[]
}

export interface D1MetricsDelta {
  rowsRead: number
  rowsWritten: number
  queryCount: number
}

/** isolate 内存电表 (启动以来累计) */
const live = {
  rowsRead: 0,
  rowsWritten: 0,
  queryCount: 0,
  bootAt: Date.now(),
  lastFlushAt: 0,
  pendingReads: 0,
  pendingWrites: 0,
  pendingQueries: 0,
}

/** 高消耗 SQL 排行 (按归一化语句聚合) */
const topMap = new Map<string, QueryStat>()
const TOP_CAP = 40

let flushing = false

/** 归一化 SQL: 字面量 → ?, 便于按语句形态聚合消耗 */
function normSql(sql: string): string {
  return sql
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

/**
 * 抄表入口 (由 DB 适配层每条 SQL 执行后调用)。
 * d1_metrics 表自身的读写跳过 — 落账动作不污染计量。
 */
export function recordQuery(sql: string, rowsRead: number, rowsWritten: number, count = 1): void {
  if (!sql || /d1_metrics/i.test(sql)) return
  const n = Math.max(0, Number(rowsRead) || 0)
  const w = Math.max(0, Number(rowsWritten) || 0)
  live.queryCount += count
  live.rowsRead += n
  live.rowsWritten += w
  live.pendingQueries += count
  live.pendingReads += n
  live.pendingWrites += w

  const key = normSql(sql)
  const cur = topMap.get(key)
  if (cur) {
    cur.count += count
    cur.rowsRead += n
    cur.rowsWritten += w
    cur.lastAt = Date.now()
    return
  }
  if (topMap.size >= TOP_CAP) {
    // 榜满: 淘汰累计消耗最低的一条; 新条目比榜上最便宜的还便宜则不入榜
    let cheapestKey: string | null = null
    let cheapestCost = Infinity
    for (const [k, v] of topMap) {
      const cost = v.rowsRead + v.rowsWritten
      if (cost < cheapestCost) {
        cheapestCost = cost
        cheapestKey = k
      }
    }
    if (cheapestKey && cheapestCost <= n + w) return
    if (cheapestKey) topMap.delete(cheapestKey)
  }
  topMap.set(key, { sql: key, count, rowsRead: n, rowsWritten: w, lastAt: Date.now() })
}

/** 当前 UTC 日期 (D1 配额按 UTC 午夜重置, 与官方口径对齐) */
export function utcDateStr(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10)
}

/** 距下一个 UTC 午夜的秒数 (配额重置倒计时) */
export function secondsUntilUtcMidnight(now: number = Date.now()): number {
  const t = new Date(now)
  const next = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1)
  return Math.max(0, Math.floor((next - now) / 1000))
}

/** 实时计量快照 (Top SQL 按行读降序) */
export function getLiveD1Metrics(): D1LiveMetrics {
  const topQueries = [...topMap.values()].sort((a, b) => b.rowsRead - a.rowsRead)
  return {
    rowsRead: live.rowsRead,
    rowsWritten: live.rowsWritten,
    queryCount: live.queryCount,
    bootAt: live.bootAt,
    lastFlushAt: live.lastFlushAt,
    pendingReads: live.pendingReads,
    pendingWrites: live.pendingWrites,
    pendingQueries: live.pendingQueries,
    topQueries,
  }
}

/** 取走并清零待落账增量 */
function takeDelta(): D1MetricsDelta {
  const d: D1MetricsDelta = {
    rowsRead: live.pendingReads,
    rowsWritten: live.pendingWrites,
    queryCount: live.pendingQueries,
  }
  live.pendingReads = 0
  live.pendingWrites = 0
  live.pendingQueries = 0
  return d
}

/** 写路径节流判定 (供适配层在 run/exec 后决定是否顺带落账) */
export function d1MetricsFlushDue(): boolean {
  return !flushing && live.pendingQueries > 0 && Date.now() - live.lastFlushAt >= D1_METRICS_FLUSH_MS
}

/**
 * 把待落账增量原子 UPSERT 进 d1_metrics (UTC 日期主键, 一天一行)。
 * force=true 供计量端点在读表前强制落账 (当前 isolate 视图即刻全局可见);
 * 否则受 60s 节流。失败时增量归还待落账池, 绝不丢账。
 */
export async function flushD1Metrics(db: DatabaseAdapter, force = false): Promise<boolean> {
  if (flushing) return false
  if (!force && Date.now() - live.lastFlushAt < D1_METRICS_FLUSH_MS) return false
  flushing = true
  const d = takeDelta()
  try {
    if (d.queryCount > 0 && db.driver !== 'memory') {
      // memory 驱动: 演示用, 内存实时视图已足够, 跳过持久化 (UPSERT 语义不适用其模拟层)
      const date = utcDateStr()
      const args = [date, d.rowsRead, d.rowsWritten, d.queryCount]
      if (db.driver === 'mysql') {
        await db.run(
          `INSERT INTO d1_metrics (metric_date, rows_read, rows_written, query_count, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE
             rows_read = rows_read + VALUES(rows_read),
             rows_written = rows_written + VALUES(rows_written),
             query_count = query_count + VALUES(query_count),
             updated_at = CURRENT_TIMESTAMP`,
          args,
        )
      } else {
        // d1 / sqlite (SQLite 方言) — 原子 UPSERT, 永不读改写
        await db.run(
          `INSERT INTO d1_metrics (metric_date, rows_read, rows_written, query_count, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(metric_date) DO UPDATE SET
             rows_read = rows_read + excluded.rows_read,
             rows_written = rows_written + excluded.rows_written,
             query_count = query_count + excluded.query_count,
             updated_at = CURRENT_TIMESTAMP`,
          args,
        )
      }
    }
    live.lastFlushAt = Date.now()
    return true
  } catch (e) {
    // 落账失败: 增量归还待落账池, 下个周期重试
    live.pendingQueries += d.queryCount
    live.pendingReads += d.rowsRead
    live.pendingWrites += d.rowsWritten
    if (force) throw e
    return false
  } finally {
    flushing = false
  }
}
