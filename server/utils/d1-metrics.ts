/**
 * D1 用量计数器 (v2.3.5) — 把免费层读配额从黑盒变成工作台核心指标。
 *
 * 数据来源分两级:
 *  - d1 驱动  : D1 响应 meta.rows_read / meta.rows_written 是引擎回报的真实
 *               扫描行数 (与 Cloudflare 计费口径一致) → 精确值 (source: 'exact')。
 *  - 其他驱动 : sqlite/mysql/memory 按返回行数/受影响行数估算 → 参考值
 *               (source: 'estimate', 本地开发时仪表盘同样有数可看)。
 *
 * 设计红线: 计数器本身不得成为新的读放大源。
 *  - 计数只发生在 isolate 内存 (纯变量自增, 零额外查询);
 *  - 落盘节流 60s 且有增量才写 (每天每 isolate 最多 1440 行 UPSERT, 可忽略);
 *  - 仪表盘读取前强制落盘再读台账 (isolate 回收最多丢最后 60s 增量, 不重复计);
 *  - 落盘用「增量 UPSERT」: 每个 isolate 只写自己自上次落盘以来的 delta,
 *    多 isolate 并发各自累加, 天然求和, 重启不重复计。
 *
 * 配额口径: D1 免费层 500 万行读/天 + 10 万行写/天, UTC 午夜重置。
 */

/** 免费层每日限额 (与 Cloudflare 官方文档一致) */
export const D1_FREE_READ_LIMIT = 5_000_000
export const D1_FREE_WRITE_LIMIT = 100_000

interface DayCounters {
  day: string
  rowsRead: number
  rowsWritten: number
  readQueries: number
  writeQueries: number
  /** 已落盘的量 (用于计算 delta, 防重复计) */
  flushedRead: number
  flushedWritten: number
  flushedReadQueries: number
  flushedWriteQueries: number
}

const state = {
  cur: null as DayCounters | null,
  lastFlushAt: 0,
  /** 落盘节流窗口 (ms) — 有增量时最多每 60s 写一次台账 */
  FLUSH_INTERVAL_MS: 60_000,
}

/** 当前 UTC 日 (D1 配额按 UTC 午夜重置) */
export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function counters(): DayCounters {
  const day = utcDay()
  if (!state.cur || state.cur.day !== day) {
    // UTC 日切换: 旧日残余 delta 已在上次 flush 落盘 (最多丢 60s), 直接换新账本
    state.cur = { day, rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0, flushedRead: 0, flushedWritten: 0, flushedReadQueries: 0, flushedWriteQueries: 0 }
  }
  return state.cur
}

/** 记录一次读查询 (rows = 真实扫描行数或估算行数) */
export function recordDbRead(rows: number): void {
  const c = counters()
  c.rowsRead += Math.max(0, rows)
  c.readQueries += 1
}

/** 记录一次写查询 (rows = 受影响/写入行数) */
export function recordDbWrite(rows: number): void {
  const c = counters()
  c.rowsWritten += Math.max(0, rows)
  c.writeQueries += 1
}

/** 距下次允许落盘的等待是否已过 */
function shouldFlush(): boolean {
  return Date.now() - state.lastFlushAt >= state.FLUSH_INTERVAL_MS
}

/**
 * 落盘当日增量到 d1_usage_daily (增量 UPSERT, 幂等)。
 * force=true 时忽略节流窗口 (仪表盘读取前调用, 保证数字最新)。
 * 内部静默容错: 台账表缺失/库未就绪时跳过, 不影响业务调用方。
 */
export async function flushD1Usage(db: { get: Function; run: Function }, force = false): Promise<void> {
  if (!state.cur) return
  const dirty = state.cur.rowsRead > state.cur.flushedRead || state.cur.rowsWritten > state.cur.flushedWritten
    || state.cur.readQueries > state.cur.flushedReadQueries || state.cur.writeQueries > state.cur.flushedWriteQueries
  if (!dirty || (!force && !shouldFlush())) return

  const c = counters()
  const dRead = c.rowsRead - c.flushedRead
  const dWrite = c.rowsWritten - c.flushedWritten
  const dReadQ = c.readQueries - c.flushedReadQueries
  const dWriteQ = c.writeQueries - c.flushedWriteQueries
  if (dRead <= 0 && dWrite <= 0 && dReadQ <= 0 && dWriteQ <= 0) return

  try {
    await db.run(
      `INSERT INTO d1_usage_daily (day, rows_read, rows_written, read_queries, write_queries, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(day) DO UPDATE SET
         rows_read = rows_read + excluded.rows_read,
         rows_written = rows_written + excluded.rows_written,
         read_queries = read_queries + excluded.read_queries,
         write_queries = write_queries + excluded.write_queries,
         updated_at = datetime('now')`,
      [c.day, dRead, dWrite, dReadQ, dWriteQ],
    )
    c.flushedRead += dRead
    c.flushedWritten += dWrite
    c.flushedReadQueries += dReadQ
    c.flushedWriteQueries += dWriteQ
    state.lastFlushAt = Date.now()
  } catch {
    // 表还没建/库只读: 静默, 下次重试 (内存计数不受影响)
  }
}

export interface D1UsageSnapshot {
  driver: string
  source: 'exact' | 'estimate'
  day: string
  rowsRead: number
  rowsWritten: number
  readQueries: number
  writeQueries: number
  limits: { read: number; write: number }
  readPct: number
  writePct: number
  readStatus: 'ok' | 'warn' | 'danger' | 'exceeded'
  writeStatus: 'ok' | 'warn' | 'danger' | 'exceeded'
  resetAt: string
  resetInSeconds: number
  history: { day: string; rowsRead: number; rowsWritten: number }[]
}

function levelOf(pct: number): 'ok' | 'warn' | 'danger' | 'exceeded' {
  if (pct >= 100) return 'exceeded'
  if (pct >= 90) return 'danger'
  if (pct >= 70) return 'warn'
  return 'ok'
}

/**
 * 读取 D1 用量快照 (供 /api/dashboard/d1-metrics):
 * 先强制落盘内存增量, 再读台账 (今天 + 近 7 天历史)。
 * 台账读取成本: 2 次索引点查 + 1 次小表 range (≤8 行), 可忽略。
 */
export async function getD1UsageSnapshot(db: any, driver: string): Promise<D1UsageSnapshot> {
  await flushD1Usage(db, true).catch(() => {})

  const c = counters()
  // 内存当日值与台账当日值取 max (台账在多 isolate 下是全量, 内存只有本 isolate)
  let day = c.day
  let rowsRead = c.rowsRead
  let rowsWritten = c.rowsWritten
  let readQueries = c.readQueries
  let writeQueries = c.writeQueries
  try {
    const row = await db.get<{ day: string; rows_read: number; rows_written: number; read_queries: number; write_queries: number }>(
      'SELECT day, rows_read, rows_written, read_queries, write_queries FROM d1_usage_daily WHERE day = ?',
      [day],
    )
    if (row) {
      rowsRead = Math.max(rowsRead, Number(row.rows_read) || 0)
      rowsWritten = Math.max(rowsWritten, Number(row.rows_written) || 0)
      readQueries = Math.max(readQueries, Number(row.read_queries) || 0)
      writeQueries = Math.max(writeQueries, Number(row.write_queries) || 0)
    }
  } catch {
    // 台账缺失: 退回本 isolate 内存值
  }

  const history: { day: string; rowsRead: number; rowsWritten: number }[] = []
  try {
    const rows = await db.all<{ day: string; rows_read: number; rows_written: number }>(
      'SELECT day, rows_read, rows_written FROM d1_usage_daily WHERE day >= ? ORDER BY day DESC LIMIT 7',
      [utcDay(new Date(Date.now() - 6 * 86400000))],
    )
    for (const r of rows || []) {
      history.push({ day: r.day, rowsRead: Number(r.rows_read) || 0, rowsWritten: Number(r.rows_written) || 0 })
    }
  } catch {
    // 无历史也照常返回
  }

  const readPct = Math.min(999, Math.round((rowsRead / D1_FREE_READ_LIMIT) * 1000) / 10)
  const writePct = Math.min(999, Math.round((rowsWritten / D1_FREE_WRITE_LIMIT) * 1000) / 10)

  // 下一次 UTC 午夜重置时间
  const now = new Date()
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0))

  return {
    driver,
    source: driver === 'd1' ? 'exact' : 'estimate',
    day,
    rowsRead,
    rowsWritten,
    readQueries,
    writeQueries,
    limits: { read: D1_FREE_READ_LIMIT, write: D1_FREE_WRITE_LIMIT },
    readPct,
    writePct,
    readStatus: levelOf(readPct),
    writeStatus: levelOf(writePct),
    resetAt: reset.toISOString(),
    resetInSeconds: Math.max(0, Math.floor((reset.getTime() - now.getTime()) / 1000)),
    history,
  }
}
