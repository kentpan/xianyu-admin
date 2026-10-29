/**
 * Database connection — single source of truth.
 *
 * The ONLY place that reads the database URL from the environment.
 * .env: XY_DATABASE_URL (e.g. file:./prisma/xianyu_admin.db)
 *
 * Every other module must import DATABASE_URL from this file —
 * reading process.env.XY_DATABASE_URL directly elsewhere is forbidden.
 */
export const DATABASE_URL: string = process.env.XY_DATABASE_URL || 'file:./prisma/xianyu_admin.db'

/** Extract the filesystem path from a DATABASE_URL ("file:./x.db" → "./x.db"). */
export function databaseFilePath(): string {
  return DATABASE_URL.replace(/^file:/, '')
}
