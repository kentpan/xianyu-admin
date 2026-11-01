/**
 * GET /api/admin/backup/export — 导出白名单表数据为 sql / db / json 下载。
 *
 * Query: tables=cookies,orders (缺省=全部白名单表) & format=sql|db|json
 *   - sql  : 每表 DELETE + INSERT 语句 (逐行 VALUES, 单引号转义), 可用 sqlite3/mysql 直接执行;
 *   - db   : SQLite 快照文件 (VACUUM INTO 产出一致性强快照); 仅 sqlite 驱动支持,
 *            D1/MySQL 如实报错并提示改用 sql/json;
 *   - json : { exported_at, driver, tables } envelope (与导入格式同源)。
 *
 * 不走 withApi/ok 信封: 让客户端拿到原始下载流。
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = await getDb()
  const q = getQuery(event)
  const format = String(q.format || 'json').toLowerCase()
  const tablesParam = String(q.tables || '').trim()

  const wanted = tablesParam && tablesParam !== 'all'
    ? tablesParam.split(',').map((s) => s.trim()).filter((s) => s && isWhitelistedTable(s))
    : [...DATA_TABLE_WHITELIST]
  if (!wanted.length) throw new ApiError(400, '未选择任何可导出的表')

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  if (format === 'db') {
    if (db.driver !== 'sqlite') {
      throw new ApiError(400, `.db 快照仅支持 SQLite 驱动 (当前驱动: ${db.driver}) — 请改用 sql 或 json 格式`)
    }
    const os = (await import('node:os')) as typeof import('node:os')
    const fs = (await import('node:fs')) as typeof import('node:fs')
    const path = (await import('node:path')) as typeof import('node:path')
    const tmp = path.join(os.tmpdir(), `xianyu-backup-${Date.now()}.db`)
    try {
      // VACUUM INTO: 产出一致性强快照 (含 WAL 已合并数据), 不阻塞在线库
      await db.run('VACUUM INTO ?', [tmp])
      const buf = fs.readFileSync(tmp)
      setHeader(event, 'content-type', 'application/octet-stream')
      setHeader(event, 'content-disposition', `attachment; filename="xianyu-admin-${stamp}.db"`)
      setHeader(event, 'content-length', String(buf.length))
      return buf
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    }
  }

  if (format === 'sql') {
    const lines: string[] = [
      `-- xianyu-admin data export`,
      `-- exported_at: ${new Date().toISOString()}`,
      `-- driver: ${db.driver}`,
      `-- 导入提示: 文本以单引号转义; 每表先 DELETE 再 INSERT (整表替换语义)`,
      '',
    ]
    for (const table of wanted) {
      let rows: any[] = []
      let cols: string[] = []
      try {
        rows = await db.all(`SELECT * FROM ${table}`)
        if (rows.length) cols = Object.keys(rows[0])
      } catch {
        rows = []
      }
      lines.push(`-- ===== table: ${table} (${rows.length} rows) =====`)
      lines.push(`DELETE FROM ${table};`)
      for (const row of rows) {
        const vals = cols.map((c) => {
          const v = row[c]
          if (v === null || v === undefined) return 'NULL'
          if (typeof v === 'number' && Number.isFinite(v)) return String(v)
          return `'${String(v).replace(/'/g, "''")}'`
        })
        lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`)
      }
      lines.push('')
    }
    const sqlText = lines.join('\n')
    setHeader(event, 'content-type', 'application/sql; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="xianyu-admin-${stamp}.sql"`)
    return sqlText
  }

  // json (默认): 与导入格式同源
  const tables: Record<string, any[]> = {}
  for (const name of wanted) {
    try {
      tables[name] = await db.all(`SELECT * FROM ${name}`)
    } catch {
      tables[name] = []
    }
  }
  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="xianyu-admin-backup-${stamp}.json"`)
  return { exported_at: new Date().toISOString(), driver: db.driver, tables }
})
