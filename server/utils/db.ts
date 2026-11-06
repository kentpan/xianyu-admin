/**
 * Unified Database Adapter Layer
 *
 * Supports seamless switching between:
 *  - sqlite  : node:sqlite (built-in, zero native deps, local Node)
 *  - mysql   : mysql2 (self-hosted / cloud)
 *  - d1      : Cloudflare D1 binding (serverless)
 *  - memory  : in-memory fallback (zero-config demo)
 *
 * Driver is selected by DB_DRIVER env, configurable from the install wizard.
 * All adapters implement the same interface, so repositories stay identical.
 *
 * Auto-adaptation (detectRuntime):
 *  - Cloudflare Pages/Workers: 'sqlite' and 'd1' both resolve to the D1
 *    binding ("DB") — there is no filesystem on Pages, so the built-in
 *    node:sqlite driver cannot be used there.
 *  - Node.js: 'd1' is rejected with a clear hint (D1 bindings only exist
 *    inside Workers/Pages); 'sqlite' uses the built-in node:sqlite module.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import type { H3Event } from 'h3'
import { DATABASE_URL } from './db-config'
import { recordQuery, d1MetricsFlushDue, flushD1Metrics } from './d1-metrics'

export interface DatabaseAdapter {
  driver: 'sqlite' | 'mysql' | 'd1' | 'memory'
  all<T = any>(sql: string, params?: any[]): Promise<T[]>
  get<T = any>(sql: string, params?: any[]): Promise<T | null>
  run(sql: string, params?: any[]): Promise<{ changes: number; lastInsertId: number | string }>
  exec(sql: string): Promise<void>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close?(): Promise<void>
}

let _adapter: DatabaseAdapter | null = null
let _initPromise: Promise<DatabaseAdapter> | null = null

export async function getDb(event?: H3Event): Promise<DatabaseAdapter> {
  if (_adapter) return _adapter
  if (_initPromise) return _initPromise
  _initPromise = createAdapter(event).catch((e) => {
    // 初始化失败后清除缓存 Promise, 允许后续请求重试
    // (例如 Cloudflare 启动阶段 D1 绑定尚未就绪)
    _initPromise = null
    throw e
  })
  _adapter = await _initPromise
  _initPromise = null
  return _adapter
}

export async function resetDb() {
  if (_adapter?.close) await _adapter.close()
  _adapter = null
  _initPromise = null
}

async function createAdapter(event?: H3Event): Promise<DatabaseAdapter> {
  const state = getRuntimeState()
  let driver = (state.dbDriver || 'sqlite') as DatabaseAdapter['driver']
  const runtime = detectRuntime()

  // ---- Runtime auto-adaptation -------------------------------------------
  if (runtime === 'cloudflare' && driver === 'sqlite') {
    // No filesystem on Cloudflare Pages: transparently fall back to D1.
    console.log('[db] cloudflare runtime + sqlite driver → auto-adapt to D1 binding')
    driver = 'd1'
  }
  if (runtime === 'node' && driver === 'd1') {
    throw new Error(
      'D1 绑定仅在 Cloudflare Pages/Workers 运行时可用。本地 Node 环境请使用 XY_DB_DRIVER=sqlite 或 mysql。',
    )
  }

  if (driver === 'd1') {
    // Cloudflare D1 binding: 优先取请求上下文(nitro 注入 event.context.cloudflare),
    // 回退到 globalThis.__env__(cloudflare-pages/module 入口在每次请求时设置),
    // 这样所有无参 getDb() 调用(146 处)在 Cloudflare 运行时都能拿到绑定。
    const cloudflare = (event?.context as any)?.cloudflare
    const d1 = cloudflare?.env?.DB ?? (globalThis as any).__env__?.DB
    if (!d1) throw new Error('D1 binding "DB" not found in Cloudflare env')
    return new D1Adapter(d1)
  }

  if (driver === 'mysql') {
    const { default: mysql } = await import('mysql2/promise')
    const conn = await mysql.createConnection({
      host: state.dbHost || '127.0.0.1',
      port: Number(state.dbPort || 3306),
      user: state.dbUser,
      password: state.dbPassword,
      database: state.dbName,
      multipleStatements: false,
    })
    return new MySQLAdapter(conn)
  }

  if (driver === 'memory') {
    return new MemoryAdapter()
  }

  // default: sqlite via the built-in node:sqlite module (Node ≥ 22.5, no native deps)
  let dbPath = state.dbUrl || DATABASE_URL
  dbPath = dbPath.replace(/^file:/, '')
  if (!path.isAbsolute(dbPath)) {
    const dir = path.dirname(dbPath)
    if (dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    dbPath = path.resolve(dbPath)
  }
  const conn = new DatabaseSync(dbPath)
  conn.exec('PRAGMA journal_mode = WAL')
  // (v2.2.7) 写锁竞争等待而非立即失败 — 根因修复: 同进程多链路并发写库 (引擎定时同步/
  // 任务回报/手动同步) 在 WAL 模式下瞬时撞锁会抛 "database is locked", 此前被上游
  // .catch 静默吞掉导致订单同步计数虚报 (拉到 120 单实际 0 单落库)。busy_timeout 让
  // 短暂锁竞争 (毫秒级) 排队等待, 只有真正持锁超 5s 才报错 — 所有写库链路统一受益,
  // 自动发货落库只会更稳, 无行为语义变化。
  conn.exec('PRAGMA busy_timeout = 5000')
  return new SQLiteAdapter(conn)
}

/* ------------------------------- SQLite ---------------------------------- */
/** Adapter over the built-in node:sqlite DatabaseSync (same engine as better-sqlite3). */
class SQLiteAdapter implements DatabaseAdapter {
  driver = 'sqlite' as const
  constructor(private conn: DatabaseSync) {}

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    recordQuery(sql, 0, 0)
    return Promise.resolve(this.conn.prepare(sql).all(...params) as T[])
  }
  get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    recordQuery(sql, 0, 0)
    return Promise.resolve((this.conn.prepare(sql).get(...params) as T | undefined) ?? null)
  }
  run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const r = this.conn.prepare(sql).run(...params)
    // 本地 sqlite 无 D1 meta: 行写以 changes 近似, 行读不计量 (dashboard 按驱动区分口径)
    recordQuery(sql, 0, Number(r.changes))
    return Promise.resolve({ changes: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) })
  }
  async exec(sql: string): Promise<void> {
    this.conn.exec(sql)
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.conn.exec('BEGIN')
    try {
      const r = await fn()
      this.conn.exec('COMMIT')
      return r
    } catch (e) {
      this.conn.exec('ROLLBACK')
      throw e
    }
  }
  async close() {
    this.conn.close()
  }
}

/* -------------------------------- MySQL ---------------------------------- */
class MySQLAdapter implements DatabaseAdapter {
  driver = 'mysql' as const
  constructor(private conn: any) {}

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    recordQuery(sql, 0, 0)
    const [rows] = await this.conn.execute(sql, params)
    return rows as T[]
  }
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    recordQuery(sql, 0, 0)
    const [rows] = await this.conn.execute(sql, params)
    return (rows as T[])[0] ?? null
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const [r] = await this.conn.execute(sql, params)
    recordQuery(sql, 0, (r as any).affectedRows ?? 0)
    return { changes: (r as any).affectedRows ?? 0, lastInsertId: (r as any).insertId ?? 0 }
  }
  async exec(sql: string): Promise<void> {
    await this.conn.query(sql)
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.conn.beginTransaction()
    try {
      const r = await fn()
      await this.conn.commit()
      return r
    } catch (e) {
      await this.conn.rollback()
      throw e
    }
  }
  async close() {
    await this.conn.end()
  }
}

/* --------------------------------- D1 ------------------------------------ */
/**
 * D1 适配器 (v2.3.5 装表): 每条语句从 meta.rows_read / meta.rows_written 精确抄表,
 * 口径与 Cloudflare 官方配额完全一致。get() 由 .first() 改走 .all() 取首行 —
 * first() 不返回 meta, 行读计量会全部丢失; 同一 SQL 的行读数不变, 行为零差异。
 * 写路径 (run/exec) 顺带节流落账 (60s 一次原子 UPSERT), 让引擎 isolate
 * (消息/发货链路) 不经过 dashboard 也能把当日累计落到 d1_metrics 表。
 */
class D1Adapter implements DatabaseAdapter {
  driver = 'd1' as const
  constructor(private d1: any) {}
  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.d1.prepare(sql).bind(...params).all().then((r: any) => {
      recordQuery(sql, r.meta?.rows_read, r.meta?.rows_written)
      return r.results ?? []
    })
  }
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    // .first() 不带 meta (行读无法计量) → 统一走 .all() 取首行, 语义完全一致
    const r = await this.d1.prepare(sql).bind(...params).all()
    recordQuery(sql, r.meta?.rows_read, r.meta?.rows_written)
    return ((r.results ?? []) as T[])[0] ?? null
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const r = await this.d1.prepare(sql).bind(...params).run()
    recordQuery(sql, r.meta?.rows_read, r.meta?.rows_written)
    // 写路径顺带落账: 节流 60s, 命中才多一次 UPSERT 往返 (await 保证在请求生命周期内完成)
    if (d1MetricsFlushDue()) await flushD1Metrics(this).catch(() => {})
    return { changes: r.meta?.changes ?? 0, lastInsertId: r.meta?.last_row_id ?? 0 }
  }
  async exec(sql: string): Promise<void> {
    // D1 has no exec; single statement runs directly, multi-statement packs into
    // one batch round-trip (schema init on cold start drops from ~130 sequential
    // round-trips to a single call)
    const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean)
    if (!stmts.length) return
    if (stmts.length === 1) {
      const r = await this.d1.prepare(stmts[0]).run()
      recordQuery(stmts[0], r.meta?.rows_read, r.meta?.rows_written)
      return
    }
    const rs: any[] = await this.d1.batch(stmts.map((s) => this.d1.prepare(s)))
    // batch 结果逐条抄表求和 (每条 statement 自带 meta)
    let reads = 0
    let writes = 0
    for (const r of rs) {
      reads += Number(r?.meta?.rows_read ?? 0)
      writes += Number(r?.meta?.rows_written ?? 0)
    }
    recordQuery(stmts[0], reads, writes, stmts.length)
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // D1 batch is non-interactive; emulate best-effort (no nested tx)
    return fn()
  }
}

/* ------------------------------- Memory ---------------------------------- */
class MemoryAdapter implements DatabaseAdapter {
  driver = 'memory' as const
  private tables = new Map<string, any[]>()
  private seq = new Map<string, number>()

  private table(sql: string): string {
    const m = sql.match(/(?:from|into|update|delete from)\s+["'`]?(\w+)/i)
    return m ? m[1].toLowerCase() : ''
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const t = this.table(sql)
    const rows = (this.tables.get(t) || []).slice()
    // very small WHERE id = ? support for lookups used in install/auth
    const wId = sql.match(/where\s+id\s*=\s*\?/i)
    if (wId) {
      return rows.filter((r) => String(r.id) === String(params[0])) as T[]
    }
    const wUser = sql.match(/where\s+username\s*=\s*\?/i)
    if (wUser) return rows.filter((r) => r.username === params[0]) as T[]
    const wKey = sql.match(/where\s+key\s*=\s*\?/i)
    if (wKey) return rows.filter((r) => r.key === params[0]) as T[]
    return rows as T[]
  }
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.all<T>(sql, params)
    return rows[0] ?? null
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const t = this.table(sql)
    if (/^insert/i.test(sql)) {
      if (!this.tables.has(t)) this.tables.set(t, [])
      const rows = this.tables.get(t)!
      const seq = (this.seq.get(t) || 0) + 1
      this.seq.set(t, seq)
      const row: any = { id: seq }
      // crude column extraction from INSERT INTO t (a,b,c) VALUES (?,?,?)
      const cols = sql.match(/\(([^)]+)\)\s*values/i)
      if (cols) {
        cols[1].split(',').map((c) => c.trim()).forEach((c, i) => {
          row[c] = params[i]
        })
      }
      rows.push(row)
      return { changes: 1, lastInsertId: seq }
    }
    if (/^update/i.test(sql)) {
      const rows = this.tables.get(t) || []
      const wId = sql.match(/where\s+id\s*=\s*\?/i)
      let changes = 0
      rows.forEach((r) => {
        if (!wId || String(r.id) === String(params[params.length - 1])) {
          changes++
        }
      })
      return { changes, lastInsertId: 0 }
    }
    if (/^delete/i.test(sql)) {
      const rows = this.tables.get(t) || []
      const wId = sql.match(/where\s+id\s*=\s*\?/i)
      if (wId) {
        const before = rows.length
        const kept = rows.filter((r) => String(r.id) !== String(params[0]))
        this.tables.set(t, kept)
        return { changes: before - kept.length, lastInsertId: 0 }
      }
      this.tables.set(t, [])
      return { changes: 0, lastInsertId: 0 }
    }
    return { changes: 0, lastInsertId: 0 }
  }
  async exec(_sql: string): Promise<void> {}
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }
}
