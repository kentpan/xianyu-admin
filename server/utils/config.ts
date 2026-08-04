/**
 * Config Manager — single source of truth for installation state & secrets.
 *
 * Nuxt's runtimeConfig is immutable at runtime, so we maintain a mutable
 * `runtimeState` singleton (initialised from process.env on first access).
 * The install wizard updates BOTH the .env file on disk AND this singleton,
 * so the running process picks up the new values immediately without restart.
 *
 * On Cloudflare Pages, .env is read-only, so the install wizard instead uses
 * the Cloudflare API (with a user-provided API token) to set environment
 * variables via the Pages project secrets endpoint.
 */
import fs from 'node:fs'
import path from 'node:path'

interface RuntimeState {
  adminSecret: string
  jwtSecret: string
  dbDriver: string
  dbUrl: string
  dbHost: string
  dbPort: string
  dbUser: string
  dbPassword: string
  dbName: string
  installed: boolean
  /** Cloudflare account ID (for API-based env config on Pages) */
  cfAccountId: string
  /** Cloudflare API token (for setting Pages env vars) */
  cfApiToken: string
  /** Cloudflare Pages project name */
  cfProjectName: string
}

let _state: RuntimeState | null = null

function loadState(): RuntimeState {
  if (_state) return _state
  _state = {
    adminSecret: process.env.XY_ADMIN_SECRET || process.env.ADMIN_SECRET || '',
    jwtSecret: process.env.XY_JWT_SECRET || process.env.JWT_SECRET || '',
    dbDriver: process.env.XY_DB_DRIVER || process.env.DB_DRIVER || 'sqlite',
    dbUrl: process.env.XY_DATABASE_URL || 'data/xianyu_admin.db',
    dbHost: process.env.XY_DB_HOST || process.env.DB_HOST || '',
    dbPort: process.env.XY_DB_PORT || process.env.DB_PORT || '',
    dbUser: process.env.XY_DB_USER || process.env.DB_USER || '',
    dbPassword: process.env.XY_DB_PASSWORD || process.env.DB_PASSWORD || '',
    dbName: process.env.XY_DB_NAME || process.env.DB_NAME || '',
    installed: process.env.XY_INSTALLED === 'true' || process.env.INSTALLED === 'true',
    cfAccountId: process.env.XY_CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '',
    cfApiToken: '', // never persisted to env for security
    cfProjectName: process.env.XY_CF_PROJECT_NAME || process.env.CF_PROJECT_NAME || '',
  }
  return _state
}

export function getRuntimeState(): RuntimeState {
  return loadState()
}

/**
 * Detect the current runtime environment.
 * Returns 'cloudflare' when running on Cloudflare Pages/Workers, 'node' otherwise.
 */
export function detectRuntime(): 'cloudflare' | 'node' {
  // Cloudflare Workers/Pages expose `caches` and have a different global
  if (typeof (globalThis as any).caches !== 'undefined' && typeof (globalThis as any).HTMLRewriter !== 'undefined') {
    return 'cloudflare'
  }
  // Check for Cloudflare-specific env bindings
  if (process.env.CF_PAGES) return 'cloudflare'
  return 'node'
}

export function getEnvPath(): string {
  return path.resolve(process.cwd(), '.env')
}

export function isInstalled(): boolean {
  const s = loadState()
  // 必须同时满足：XY_INSTALLED=true 且密钥已配置（确保安装向导完整执行）
  return s.installed && Boolean(s.adminSecret && s.jwtSecret)
}

function readEnvFile(): Record<string, string> {
  const envPath = getEnvPath()
  const map: Record<string, string> = {}
  if (!fs.existsSync(envPath)) return map
  const content = fs.readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    map[key] = val
  }
  return map
}

/** Persist install-wizard values to .env on disk + update the live runtime state. */
export function applyInstallConfig(values: {
  adminSecret: string
  jwtSecret: string
  dbDriver: string
  dbUrl?: string
  dbHost?: string
  dbPort?: string
  dbUser?: string
  dbPassword?: string
  dbName?: string
  adminUsername: string
  adminPassword: string
  adminEmail: string
}): void {
  const existing = readEnvFile()
  const next: Record<string, string> = {
    ...existing,
    XY_ADMIN_SECRET: values.adminSecret,
    XY_JWT_SECRET: values.jwtSecret,
    XY_DB_DRIVER: values.dbDriver,
    XY_INSTALLED: 'true',
  }
  if (values.dbUrl !== undefined) next.XY_DATABASE_URL = values.dbUrl
  if (values.dbHost !== undefined) next.XY_DB_HOST = values.dbHost
  if (values.dbPort !== undefined) next.XY_DB_PORT = values.dbPort
  if (values.dbUser !== undefined) next.XY_DB_USER = values.dbUser
  if (values.dbPassword !== undefined) next.XY_DB_PASSWORD = values.dbPassword
  if (values.dbName !== undefined) next.XY_DB_NAME = values.dbName

  const body = Object.entries(next)
    .map(([k, v]) => `${k}=${v.includes(' ') ? `"${v}"` : v}`)
    .join('\n')
  fs.writeFileSync(getEnvPath(), body + '\n', 'utf-8')

  // Reflect into process.env and the mutable runtime state (single source of truth)
  for (const [k, v] of Object.entries(next)) {
    process.env[k] = v
  }
  const s = loadState()
  s.adminSecret = values.adminSecret
  s.jwtSecret = values.jwtSecret
  s.dbDriver = values.dbDriver
  s.installed = true
  if (values.dbUrl !== undefined) s.dbUrl = values.dbUrl
  if (values.dbHost !== undefined) s.dbHost = values.dbHost
  if (values.dbPort !== undefined) s.dbPort = values.dbPort
  if (values.dbUser !== undefined) s.dbUser = values.dbUser
  if (values.dbPassword !== undefined) s.dbPassword = values.dbPassword
  if (values.dbName !== undefined) s.dbName = values.dbName
}

/**
 * Set environment variables on Cloudflare Pages project via the Cloudflare API.
 * Uses the Pages Deployment Secrets endpoint to set multiple env vars at once.
 * Requires cfAccountId + cfApiToken + cfProjectName.
 *
 * @returns array of { key, success, error? } for each variable
 */
export async function applyCloudflareEnvVars(opts: {
  accountId: string
  apiToken: string
  projectName: string
  vars: Record<string, string>
}): Promise<{ key: string; success: boolean; error?: string }[]> {
  const { accountId, apiToken, projectName, vars } = opts
  const results: { key: string; success: boolean; error?: string }[] = []

  // Cloudflare Pages API: PATCH /accounts/{account_id}/pages/projects/{project_name}
  // Body: { deployment_configs: { production: { env_vars: { KEY: { value: "..." } } } } }
  const envVars: Record<string, { value: string }> = {}
  for (const [k, v] of Object.entries(vars)) {
    envVars[k] = { value: v }
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deployment_configs: {
            production: { env_vars: envVars },
            preview: { env_vars: envVars },
          },
        }),
      },
    )
    const data: any = await res.json()
    if (!data.success) {
      for (const k of Object.keys(vars)) {
        results.push({ key: k, success: false, error: data.errors?.[0]?.message || 'API error' })
      }
    } else {
      for (const k of Object.keys(vars)) {
        results.push({ key: k, success: true })
      }
    }
  } catch (e: any) {
    for (const k of Object.keys(vars)) {
      results.push({ key: k, success: false, error: e.message || 'Network error' })
    }
  }

  // Also update the live runtime state (so the current process picks up values)
  const s = loadState()
  if (vars.XY_ADMIN_SECRET) s.adminSecret = vars.XY_ADMIN_SECRET
  if (vars.XY_JWT_SECRET) s.jwtSecret = vars.XY_JWT_SECRET
  if (vars.XY_DB_DRIVER) s.dbDriver = vars.XY_DB_DRIVER
  if (vars.XY_INSTALLED) s.installed = vars.XY_INSTALLED === 'true'

  return results
}

/** Public system settings (no secrets) — surfaced to the client. */
export async function getPublicSettings(): Promise<Record<string, any>> {
  const db = await getDb()
  const rows = await db.all<{ key_name: string; value: string }>(
    'SELECT key_name, value FROM system_settings',
  )
  const map: Record<string, any> = {}
  for (const r of rows) {
    let v: any = r.value
    if (v === 'true') v = true
    else if (v === 'false') v = false
    else if (/^-?\d+$/.test(v)) v = Number(v)
    map[r.key_name] = v
  }
  return map
}

/** Upsert a system setting. */
export async function setSystemSetting(key: string, value: string, description?: string): Promise<void> {
  const db = await getDb()
  const existing = await db.get('SELECT key_name FROM system_settings WHERE key_name = ?', [key])
  if (existing) {
    await db.run('UPDATE system_settings SET value = ?, description = COALESCE(?, description), updated_at = CURRENT_TIMESTAMP WHERE key_name = ?', [value, description ?? null, key])
  } else {
    await db.run('INSERT INTO system_settings (key_name, value, description) VALUES (?, ?, ?)', [key, value, description ?? null])
  }
}
