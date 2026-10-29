/**
 * engine-auth — 监听引擎/远程代理统一鉴权 (Authorization: Bearer token)。
 *
 * 规范: 所有 /api/engine/* 端点只认标准 `Authorization: Bearer <token>` 请求头,
 * 不再使用任何自定义 header。token 为 engines 表每引擎独立 48 位十六进制串,
 * 在「监听服务」页查看/复制/重置, 重置即时作废旧连接。
 *
 * Bearer token 同时承担身份识别: token → engines 行, 无需额外标识头。
 */
import crypto from 'node:crypto'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { getDb } from './db'

export interface EngineIdentity {
  id: number
  slug: string
  name: string
  type: string
  enabled: number
  is_active: number
  host: string
  port: number
}

/** 生成 48 位十六进制随机令牌。 */
export function generateEngineToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

/** 从请求中提取 Bearer token (标准 Authorization 头, 不接受其他形式)。 */
export function extractBearerToken(event: H3Event): string {
  const auth = getHeader(event, 'authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.slice(7).trim()
}

/**
 * 校验 Bearer token 并返回引擎身份; 不合法抛 401。
 * 查库按 token 精确匹配后再做 timingSafeEqual 比对, 恒定时间防时序侧信道。
 */
export async function requireEngine(event: H3Event): Promise<EngineIdentity> {
  const token = extractBearerToken(event)
  if (!token) {
    throw createError({ statusCode: 401, message: '缺少 Authorization: Bearer <token> 引擎令牌' })
  }

  const db = await getDb()
  const row = await db.get<EngineIdentity & { token: string }>(
    'SELECT id, slug, name, type, enabled, is_active, host, port, token FROM engines WHERE token = ?',
    [token],
  )
  const a = Buffer.from(token)
  const b = Buffer.from(row?.token || '')
  if (!row || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw createError({ statusCode: 401, message: '引擎令牌无效或已被重置' })
  }
  if (!row.enabled) {
    throw createError({ statusCode: 403, message: '该引擎已在后台停用' })
  }
  return row
}
