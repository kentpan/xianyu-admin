/**
 * GET /api/dashboard/d1-metrics — D1 读写配额核心指标 (v2.3.5)。
 *
 * 数据链路: db 适配层计量 (D1 用引擎真实 rows_read/rows_written) → isolate 内存
 * 计数 → 读取时落盘台账 d1_usage_daily → 与台账当日值取 max 返回。
 * 端点自身成本: 1 次增量 UPSERT (60s 节流) + 2 次台账小查 (≤8 行), 可忽略。
 */
import { getD1UsageSnapshot } from '../../utils/d1-metrics'

export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()
    const state = getRuntimeState()
    const snapshot = await getD1UsageSnapshot(db, db.driver || state.dbDriver || 'sqlite')
    return ok(snapshot)
  }),
)
