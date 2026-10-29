/**
 * api-key-auth — 验证码核销开放接口的业务方鉴权 (Authorization: Bearer <api_key>)。
 *
 * 身份: api_keys 表每业务方独立 Key (明文存储, 后台可反复查看+复制)。
 * 限速: 每 Key 滑动窗口计数 (内存, 默认 30 次/60s, 数值+窗口均可按 Key 配置)。
 * 留痕: 每次通过鉴权的调用写 api_key_logs 并累计 api_keys 计数列, 供统计报表。
 */
import crypto from 'node:crypto'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { getDb } from './db'

export interface ApiKeyIdentity {
  id: number
  name: string
  rate_limit_num: number
  rate_limit_window: number
}

/** 生成业务方 API Key: xyk_ + 48 位十六进制 (前缀便于泄漏识别与检索)。 */
export function generateApiKey(): string {
  return `xyk_${crypto.randomBytes(24).toString('hex')}`
}

/**
 * 归一化 API Key 有效期入参 → 'YYYY-MM-DD HH:MM:SS' (UTC) 或 null (永久)。
 * 接受: null/'' → 永久; 'YYYY-MM-DD' → 当日 UTC 23:59:59; 'YYYY-MM-DD HH:mm:ss' 原样校验。
 */
export function normalizeApiKeyExpiry(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return null
  const s = String(input).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 23:59:59`
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const v = s.length === 16 ? `${s}:00` : s
    return Number.isFinite(new Date(v.replace(' ', 'T') + 'Z').getTime()) ? v : null
  }
  throw createError({ statusCode: 400, message: '有效期格式无效 (应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss)' })
}

/** 8 位无符号随机验证码 (crypto.randomInt 无模偏)。 */
export function generateVerifyCode(): string {
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, '0')
}

// 滑动窗口限速: keyId → 窗口内时间戳数组 (进程内, 单实例部署足够)
const rateBuckets = new Map<number, number[]>()

function hitRateLimit(keyId: number, limitNum: number, windowSec: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const windowMs = Math.max(1, windowSec) * 1000
  const list = (rateBuckets.get(keyId) || []).filter((t) => now - t < windowMs)
  if (list.length >= Math.max(1, limitNum)) {
    rateBuckets.set(keyId, list)
    const retryAfter = Math.ceil((list[0] + windowMs - now) / 1000)
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) }
  }
  list.push(now)
  rateBuckets.set(keyId, list)
  return { allowed: true, retryAfter: 0 }
}

export function extractApiKeyToken(event: H3Event): string {
  const auth = getHeader(event, 'authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.slice(7).trim()
}

/**
 * 校验 Bearer API Key + 限速, 返回业务方身份; 失败抛 401/403/429。
 * 通过后写调用日志并累计计数 (endpoint 标识用途, success 由调用方在业务判定后回填补录)。
 */
export async function requireApiKey(event: H3Event, endpoint = 'verify'): Promise<ApiKeyIdentity> {
  const token = extractApiKeyToken(event)
  if (!token) {
    throw createError({ statusCode: 401, message: '缺少 Authorization: Bearer <apikey> 请求头' })
  }
  const db = await getDb()
  const row = await db.get<ApiKeyIdentity & { api_key: string; enabled: number; expires_at: string | null }>(
    'SELECT id, name, api_key, rate_limit_num, rate_limit_window, enabled, expires_at FROM api_keys WHERE api_key = ?',
    [token],
  )
  const a = Buffer.from(token)
  const b = Buffer.from(row?.api_key || '')
  if (!row || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw createError({ statusCode: 401, message: 'API Key 无效' })
  }
  if (!row.enabled) {
    throw createError({ statusCode: 403, message: '该 API Key 已在后台停用' })
  }
  if (row.expires_at) {
    const exp = new Date(String(row.expires_at).replace(' ', 'T') + 'Z').getTime()
    if (Number.isFinite(exp) && Date.now() >= exp) {
      await logApiKeyCall(row.id, endpoint, false, 403, `Key 已过期 (${row.expires_at})`, event)
      throw createError({ statusCode: 403, message: `该 API Key 已过期 (过期时间 ${row.expires_at})` })
    }
  }

  const limit = await hitRateLimit(row.id, row.rate_limit_num, row.rate_limit_window)
  if (!limit.allowed) {
    await logApiKeyCall(row.id, endpoint, false, 429, `限速触发 (${row.rate_limit_num}次/${row.rate_limit_window}s)`, event)
    throw createError({ statusCode: 429, message: `请求过于频繁, 请 ${limit.retryAfter} 秒后重试 (限速 ${row.rate_limit_num} 次/${row.rate_limit_window}s)` })
  }

  await db
    .run('UPDATE api_keys SET total_calls = total_calls + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id])
    .catch(() => {})

  return { id: row.id, name: row.name, rate_limit_num: row.rate_limit_num, rate_limit_window: row.rate_limit_window }
}

/** 客户端 IP (穿透常见反代头; 沙盒/网关场景取不到就回落 0.0.0.0)。 */
export function clientIp(event: H3Event): string {
  const xff = getHeader(event, 'x-forwarded-for') || ''
  const first = xff.split(',')[0]?.trim()
  return first || getHeader(event, 'x-real-ip') || '0.0.0.0'
}

/** 核销调用留痕 + 成败计数 (失败不抛出, 避免影响主流程响应)。 */
export async function logApiKeyCall(
  keyId: number,
  endpoint: string,
  success: boolean,
  statusCode: number,
  message: string,
  event: H3Event,
): Promise<void> {
  try {
    const db = await getDb()
    await db.run(
      'INSERT INTO api_key_logs (api_key_id, endpoint, success, status_code, message, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [keyId, endpoint.slice(0, 64), success ? 1 : 0, statusCode, message.slice(0, 255), clientIp(event)],
    )
    await db
      .run(
        success
          ? 'UPDATE api_keys SET total_success = total_success + 1 WHERE id = ?'
          : 'UPDATE api_keys SET total_failed = total_failed + 1 WHERE id = ?',
        [keyId],
      )
      .catch(() => {})
  } catch {}
}
