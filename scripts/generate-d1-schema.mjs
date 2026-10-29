/**
 * generate-d1-schema.mjs — 从唯一事实源 server/utils/schema.ts 生成 Cloudflare D1 部署所需 SQL
 * ----------------------------------------------------------------------------
 * actions-scripts-base 的 setup-d1.ts 约定项目必须提供:
 *   prisma/d1-schema.sql — 完整建表 + 索引 (幂等, 可在每次部署重复执行)
 *   prisma/seed.sql      — 默认种子数据 (幂等)
 *
 * 本脚本把 schema.ts 中的 SCHEMA(SQLite 方言) + MIGRATIONS(增量列) 在临时内存库
 * 中物化成"最终态", 再导出为 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS,
 * 保证 D1 与本地 node:sqlite 的表结构永远一致, 不会漂移。
 *
 * 用法: node scripts/generate-d1-schema.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { DatabaseSync } from 'node:sqlite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = readFileSync(join(root, 'server/utils/schema.ts'), 'utf8')

// TS → CJS (schema.ts 仅含编译期类型引用, 无运行时依赖)
const appended = src + '\nexport { SCHEMA, MIGRATIONS, DEFAULT_SETTINGS }\n'
const js = esbuild.transformSync(appended, { loader: 'ts', format: 'cjs' }).code
const mod = { exports: {} }
new Function('exports', 'module', 'require', js)(mod.exports, mod, () => ({}))
const { SCHEMA, MIGRATIONS, DEFAULT_SETTINGS } = mod.exports
if (!Array.isArray(SCHEMA) || !Array.isArray(MIGRATIONS)) {
  throw new Error('schema.ts 解析失败: SCHEMA/MIGRATIONS 缺失')
}

// 在临时内存库中按 SQLite 方言物化最终态
const db = new DatabaseSync(':memory:')
for (const stmt of SCHEMA) db.exec(stmt.replace(/__AUTO__/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'))
for (const stmt of MIGRATIONS) {
  try {
    db.exec(stmt)
  } catch {
    // 列已存在 — 预期情况(与 initSchema 的容错一致)
  }
}

const tables = db
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
const indexes = db
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")
  .all()

const header =
  '-- ⚠️ 自动生成文件: 由 scripts/generate-d1-schema.mjs 从 server/utils/schema.ts 物化导出, 请勿手改\n' +
  '-- 重新生成: node scripts/generate-d1-schema.mjs\n\n'

const ddl = []
for (const t of tables) {
  ddl.push('-- 表: ' + t.name + '\n' + t.sql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ') + ';')
}
for (const i of indexes) {
  ddl.push(i.sql.replace(/^CREATE INDEX\s+(IF NOT EXISTS\s+)?/i, 'CREATE INDEX IF NOT EXISTS ') + ';')
}
writeFileSync(join(root, 'prisma/d1-schema.sql'), header + ddl.join('\n\n') + '\n')

// 种子数据: system_settings 默认配置 (key_name 为 PRIMARY KEY, INSERT OR IGNORE 幂等)
const esc = (v) => String(v).replace(/'/g, "''")
const seed = DEFAULT_SETTINGS.map(
  (s) =>
    `INSERT OR IGNORE INTO system_settings (key_name, value, description) VALUES ('${esc(s.key)}', '${esc(s.value)}', '${esc(s.description)}');`,
).join('\n')
writeFileSync(
  join(root, 'prisma/seed.sql'),
  header + '-- 默认系统配置 (key_name 主键, INSERT OR IGNORE 幂等, 可重复执行)\n' + seed + '\n',
)

console.log(`✓ prisma/d1-schema.sql: ${tables.length} tables, ${indexes.length} indexes`)
console.log(`✓ prisma/seed.sql: ${DEFAULT_SETTINGS.length} settings`)
db.close()
