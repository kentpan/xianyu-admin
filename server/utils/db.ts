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
import { recordDbRead, recordDbWrite } from './d1-metrics'

/**
 * (v2.3.5) 用量计量挂钩: 所有驱动在执行层回报读/写行数。
 * D1 用响应 meta.rows_read/rows_written (引擎真实扫描行数, 与计费口径一致),
 * 其余驱动按返回行数/受影响行数估算。计数纯内存自增, 零额外查询。
 */
function meterRead(rows: number): void {
  try { recordDbRead(rows) } catch { /* 计量永不影响业务 */ }
}
function meterWrite(rows: number): void {
  try { recordDbWrite(rows) } catch { /* 计量永不影响业务 */ }
}

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
  // ---- 库文件健康守卫 (v2.3.12, "database disk image is malformed" 执行层根修) ----
  quarantineOrphanedWalSidecars(dbPath)
  const conn = new DatabaseSync(dbPath)
  conn.exec('PRAGMA journal_mode = WAL')
  // (v2.2.7) 写锁竞争等待而非立即失败 — 根因修复: 同进程多链路并发写库 (引擎定时同步/
  // 任务回报/手动同步) 在 WAL 模式下瞬时撞锁会抛 "database is locked", 此前被上游
  // .catch 静默吞掉导致订单同步计数虚报 (拉到 120 单实际 0 单落库)。busy_timeout 让
  // 短暂锁竞争 (毫秒级) 排队等待, 只有真正持锁超 5s 才报错 — 所有写库链路统一受益,
  // 自动发货落库只会更稳, 无行为语义变化。
  conn.exec('PRAGMA busy_timeout = 5000')
  // 启动期完整性核验 (库文件 MB 级, 毫秒级开销): 损坏库在此大声失败 (附文件路径与
  // 处置指引), 绝不带病运行到业务请求期才以零散 sqlite 错误暴露。
  const ic = conn.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
  if (!ic || ic.integrity_check !== 'ok') {
    conn.close()
    throw new Error(
      `SQLite 库完整性核验未通过 (${dbPath}): ${JSON.stringify(ic ?? null)} — 数据库文件损坏。`
      + '请从最近备份恢复或重新部署 --db 包后重启; 若曾人工替换过库文件, 请确认同目录无上一代遗留的 -wal/-shm 边车文件',
    )
  }
  return new SQLiteAdapter(conn)
}

/**
 * 隔离孤儿 WAL/SHM 边车文件 (v2.3.12 — "database disk image is malformed" 执行层根修)。
 *
 * 根因机制: 服务器用新部署包 (--db 快照) 覆盖旧部署时, 上一代库遗留的 -wal/-shm
 * 边车文件不在包内、不会被覆盖; SQLite 打开新主库时按 WAL 恢复语义重放这些异源帧,
 * 把旧代页面写入新库 → 页面结构错乱 → 查询/integrity_check 报 malformed。
 *
 * 判定 (最小充分条件): 主库 mtime 比 WAL 新 = WAL 必属上一代 (其内容要么已被
 * checkpoint 进主库, 要么主库已被整体替换) —— 两种解释下重放 WAL 都只可能引入旧
 * 页面, 隔离是严格更安全的选择:
 *   - 主库是 deploy.sh --db 的 VACUUM INTO 快照时自身即完整, 隔离零数据损失;
 *   - walMtime >= dbMtime (同代或更新) 时不做任何动作, 交给 SQLite 正常恢复
 *     (崩溃遗留的同代 WAL 含未 checkpoint 事务, 重放正是数据恢复语义)。
 * 隔离 = 重命名保留现场 (不删除), 全程大声日志; 隔离失败则拒绝打开 (fail hard)。
 */
function quarantineOrphanedWalSidecars(dbPath: string): void {
  const walPath = `${dbPath}-wal`
  const shmPath = `${dbPath}-shm`
  let hasWal = false
  let hasShm = false
  try {
    hasWal = fs.existsSync(walPath)
    hasShm = fs.existsSync(shmPath)
  } catch {
    return
  }
  if (!hasWal && !hasShm) return

  let dbMtime = 0
  let walMtime = 0
  try {
    dbMtime = fs.statSync(dbPath).mtimeMs
    // 无 -wal (只有 -shm) 时无任何帧可重放, 视为同代不隔离
    walMtime = hasWal ? fs.statSync(walPath).mtimeMs : dbMtime
  } catch (e: any) {
    console.log(`[db] 边车孤儿判定探测失败, 放行交由 SQLite 处理: ${e?.message || e}`)
    return
  }
  if (walMtime >= dbMtime) return

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const p of [walPath, shmPath]) {
    if (!fs.existsSync(p)) continue
    const dst = `${p}.orphan-${stamp}`
    try {
      fs.renameSync(p, dst)
      console.warn(
        `[db] 已隔离孤儿边车: ${p} → ${dst} (主库比 WAL 新, WAL 属于已被替换的上一代库; `
        + '重放异源 WAL 是 "database disk image is malformed" 的根因。隔离保留现场, 运行正常后可手动删除)',
      )
    } catch (e: any) {
      throw new Error(
        `孤儿 WAL 边车隔离失败 (${p} → ${dst}): ${e?.message || e}`
        + ' — 拒绝在异源 WAL 在场时打开主库, 请手动清理该文件后重试',
      )
    }
  }
}

/* ------------------------------- SQLite ---------------------------------- */
/** Adapter over the built-in node:sqlite DatabaseSync (same engine as better-sqlite3). */
class SQLiteAdapter implements DatabaseAdapter {
  driver = 'sqlite' as const
  constructor(private conn: DatabaseSync) {}

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const rows = this.conn.prepare(sql).all(...params) as T[]
    meterRead(rows.length) // (v2.3.5) 本地驱动按返回行数估算
    return Promise.resolve(rows)
  }
  get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const row = (this.conn.prepare(sql).get(...params) as T | undefined) ?? null
    meterRead(row ? 1 : 0)
    return Promise.resolve(row)
  }
  run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const r = this.conn.prepare(sql).run(...params)
    meterWrite(Number(r.changes) || 0)
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
    const [rows] = await this.conn.execute(sql, params)
    meterRead(Array.isArray(rows) ? rows.length : 0)
    return rows as T[]
  }
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const [rows] = await this.conn.execute(sql, params)
    meterRead(Array.isArray(rows) && rows.length ? 1 : 0)
    return (rows as T[])[0] ?? null
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const [r] = await this.conn.execute(sql, params)
    meterWrite((r as any).affectedRows ?? 0)
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
class D1Adapter implements DatabaseAdapter {
  driver = 'd1' as const
  constructor(private d1: any) {}
  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.d1.prepare(sql).bind(...params).all().then((r: any) => {
      // (v2.3.5) meta.rows_read = 引擎真实扫描行数 (与 CF 计费口径一致)
      meterRead(Number(r?.meta?.rows_read ?? (r?.results?.length || 0)))
      return r.results ?? []
    })
  }
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    // (v2.3.5) first() 不回传 meta, 改用 all() 取首行 — 同样的扫描量, 但能拿到
    // 真实 rows_read/rows_written 计入用量台账 (计量是本次升级的核心需求)
    const r = await this.d1.prepare(sql).bind(...params).all()
    meterRead(Number(r?.meta?.rows_read ?? (r?.results?.length || 0)))
    return ((r?.results as T[])?.[0]) ?? null
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const r = await this.d1.prepare(sql).bind(...params).run()
    // (v2.3.5) 写路径同样计量: rows_written = 实际写入行数, rows_read = WHERE 扫描行数
    meterWrite(Number(r?.meta?.rows_written ?? r?.meta?.changes ?? 0))
    if (Number(r?.meta?.rows_read ?? 0) > 0) meterRead(Number(r.meta.rows_read))
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
      meterWrite(Number(r?.meta?.rows_written ?? 0))
      if (Number(r?.meta?.rows_read ?? 0) > 0) meterRead(Number(r.meta.rows_read))
      return
    }
    const rs = await this.d1.batch(stmts.map((s) => this.d1.prepare(s)))
    for (const r of rs || []) {
      meterWrite(Number(r?.meta?.rows_written ?? 0))
      if (Number(r?.meta?.rows_read ?? 0) > 0) meterRead(Number(r.meta.rows_read))
    }
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
