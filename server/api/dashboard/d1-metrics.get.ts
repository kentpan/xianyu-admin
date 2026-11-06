/**
 * GET /api/dashboard/d1-metrics — 数据库读写用量核心指标 (v2.3.5)。
 *
 * 数据来源:
 *  - d1_metrics 表 (UTC 日期主键, 各 isolate 电表 60s 节流原子 UPSERT 汇总)
 *    = 全局当日累计, 口径与 Cloudflare 官方配额一致 (meta.rows_read / rows_written)
 *  - isolate 内存实时视图 (本实例启动以来累计 + 高消耗 SQL Top 排行)
 *
 * 读表前先把当前 isolate 的待落账增量强制 flush — 看到的数字即最新。
 * 成本: 每次轮询 = 1 次落账 UPSERT (≤1 行写) + 1 次范围读 (≤14 行读), 对 5M
 * 日配额而言可忽略; 配合前端 60s 可见性感知轮询, 每天最多 ~1440 次调用。
 *
 * 注意: 行读/行写精确计量仅 D1 驱动 (meta 来自 D1 引擎); sqlite/mysql/memory
 * 驱动下 rows 记 0/近似值, 前端按 driver 标注口径。
 */
import { D1_FREE_READ_LIMIT, D1_FREE_WRITE_LIMIT, flushD1Metrics, getLiveD1Metrics, secondsUntilUtcMidnight, utcDateStr } from '../../utils/d1-metrics'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    // 强制落账当前 isolate 增量 → 表内当日值即刻全局最新
    await flushD1Metrics(db, true).catch(() => {})

    const today = utcDateStr()
    // 近 14 天历史 (主键范围扫描, ≤14 行读)
    const since = utcDateStr(new Date(Date.now() - 13 * 86400000))
    const history = await db
      .all<{ metric_date: string; rows_read: number; rows_written: number; query_count: number }>(
        'SELECT metric_date, rows_read, rows_written, query_count FROM d1_metrics WHERE metric_date >= ? ORDER BY metric_date DESC LIMIT 14',
        [since],
      )
      .catch(() => [])

    const todayRow = history.find((r) => r.metric_date === today)
    const rowsRead = Number(todayRow?.rows_read || 0)
    const rowsWritten = Number(todayRow?.rows_written || 0)
    const queryCount = Number(todayRow?.query_count || 0)

    const live = getLiveD1Metrics()
    const isD1 = db.driver === 'd1'

    return ok({
      driver: db.driver,
      /** 行读精确计量仅 D1 驱动 (meta 口径) */
      metered: isD1,
      dateUtc: today,
      limits: { reads: D1_FREE_READ_LIMIT, writes: D1_FREE_WRITE_LIMIT },
      today: {
        rowsRead,
        rowsWritten,
        queryCount,
        readPercent: Math.min(100, Math.round((rowsRead / D1_FREE_READ_LIMIT) * 10000) / 100),
        writePercent: Math.min(100, Math.round((rowsWritten / D1_FREE_WRITE_LIMIT) * 10000) / 100),
      },
      /** 配额重置倒计时 (秒, UTC 午夜) */
      resetInSec: secondsUntilUtcMidnight(),
      /** 本 isolate 实时视图 (启动以来累计; 表值 = 各 isolate 落账汇总) */
      live: {
        rowsRead: live.rowsRead,
        rowsWritten: live.rowsWritten,
        queryCount: live.queryCount,
        pendingReads: live.pendingReads,
        pendingWrites: live.pendingWrites,
        uptimeSec: Math.floor((Date.now() - live.bootAt) / 1000),
      },
      /** 高消耗 SQL 排行 (本 isolate, 按行读降序, 前 8 条) */
      topQueries: live.topQueries.slice(0, 8),
      /** 近 14 天用量历史 (旧→新) */
      history: history
        .map((r) => ({
          date: r.metric_date,
          rowsRead: Number(r.rows_read || 0),
          rowsWritten: Number(r.rows_written || 0),
          queryCount: Number(r.query_count || 0),
        }))
        .reverse(),
    })
  }),
)
