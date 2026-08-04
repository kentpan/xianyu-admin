/**
 * Unified Database Adapter Layer
 *
 * Supports seamless switching between:
 *  - sqlite  : better-sqlite3 (local Node)
 *  - mysql   : mysql2 (self-hosted / cloud)
 *  - d1      : Cloudflare D1 binding (serverless)
 *  - memory  : in-memory fallback (zero-config demo)
 *
 * Driver is selected by DB_DRIVER env, configurable from the install wizard.
 * All adapters implement the same interface, so repositories stay identical.
 */
import type { H3Event } from 'h3'

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
  _initPromise = createAdapter(event)
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
  const driver = (state.dbDriver || 'sqlite') as DatabaseAdapter['driver']

  if (driver === 'd1') {
    // Cloudflare D1 binding via Nitro cloudflare context
    const cloudflare = (event?.context as any)?.cloudflare
    const d1 = cloudflare?.env?.DB
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

  // default: sqlite
  const Database = (await import('better-sqlite3')).default
  const fs = await import('node:fs')
  const path = await import('node:path')
  let dbPath = state.dbUrl || 'data/xianyu_admin.db'
  dbPath = dbPath.replace(/^file:/, '')
  if (dbPath.startsWith('data/') || !path.isAbsolute(dbPath)) {
    const dir = path.dirname(dbPath)
    fs.mkdirSync(dir, { recursive: true })
  }
  const conn = new Database(dbPath)
  conn.pragma('journal_mode = WAL')
  return new SQLiteAdapter(conn)
}

/* ------------------------------- SQLite ---------------------------------- */
class SQLiteAdapter implements DatabaseAdapter {
  driver = 'sqlite' as const
  constructor(private conn: any) {}

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return Promise.resolve(this.conn.prepare(sql).all(...params))
  }
  get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    return Promise.resolve(this.conn.prepare(sql).get(...params) ?? null)
  }
  run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const r = this.conn.prepare(sql).run(...params)
    return Promise.resolve({ changes: r.changes, lastInsertId: r.lastInsertRowid as number })
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
    return rows as T[]
  }
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const [rows] = await this.conn.execute(sql, params)
    return (rows as T[])[0] ?? null
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const [r] = await this.conn.execute(sql, params)
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
    return this.d1.prepare(sql).bind(...params).all().then((r: any) => r.results ?? [])
  }
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const r = await this.d1.prepare(sql).bind(...params).first()
    return (r as T) ?? null
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertId: number | string }> {
    const r = await this.d1.prepare(sql).bind(...params).run()
    return { changes: r.meta?.changes ?? 0, lastInsertId: r.meta?.last_row_id ?? 0 }
  }
  async exec(sql: string): Promise<void> {
    // D1 has no exec; split & run statements
    const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean)
    for (const s of stmts) {
      await this.d1.prepare(s).run()
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
