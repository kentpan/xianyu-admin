/**
 * Auth utilities: JWT issuing/verification + password hashing.
 * All secrets come from runtime config (env), never hard-coded.
 */
import bcrypt from 'bcryptjs'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError } from 'h3'

export interface JwtPayload {
  userId: number
  username: string
  isAdmin: boolean
}

// HS256 JWT(node:crypto 同步实现): 签名格式与 jsonwebtoken 完全兼容, 旧 token 仍可验证。
// 弃用 jsonwebtoken 根因: 其依赖 jws 在模块顶层执行 util.inherits(x, Stream.Transform),
// 在 Cloudflare Pages/Workers(nodejs_compat + unenv polyfill)下 Stream 类 prototype
// 为 undefined, 发布验证阶段直接抛 "superCtor.prototype ... Received undefined" 致部署失败
// (cloudflare/workerd#4035, nuxt-hub/core#502 同因)。workerd 对 createHmac/timingSafeEqual/
// Buffer base64url 均原生支持; edge-realtime Worker 的 WebCrypto 校验亦与此格式互通。
const JWT_ALG = 'HS256'
const JWT_TTL_SECONDS = 7 * 24 * 60 * 60
const B64URL_RE = /^[A-Za-z0-9_-]+$/

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

function hs256Signature(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest()
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10)
}

export function verifyPassword(plain: string, hash: string): boolean {
  if (!hash) return false
  try {
    return bcrypt.compareSync(plain, hash)
  } catch {
    return false
  }
}

export function signToken(payload: JwtPayload): string {
  const secret = getRuntimeState().jwtSecret
  if (!secret) throw new Error('JWT_SECRET is not configured')
  const now = Math.floor(Date.now() / 1000)
  const header = encodeSegment({ alg: JWT_ALG, typ: 'JWT' })
  const body = encodeSegment({ ...payload, iat: now, exp: now + JWT_TTL_SECONDS })
  return `${header}.${body}.${hs256Signature(`${header}.${body}`, secret).toString('base64url')}`
}

export function verifyToken(token: string): JwtPayload | null {
  const secret = getRuntimeState().jwtSecret
  if (!secret) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts.every(p => B64URL_RE.test(p))) return null
    const [header, body, signature] = parts
    const expected = hs256Signature(`${header}.${body}`, secret)
    const received = Buffer.from(signature, 'base64url')
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
    const parsedHeader = decodeSegment(header) as { alg?: string } | null
    if (parsedHeader?.alg !== JWT_ALG) return null
    const parsed = decodeSegment(body) as (JwtPayload & { exp?: number }) | null
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null
    return { userId: parsed.userId, username: parsed.username, isAdmin: !!parsed.isAdmin }
  } catch {
    return null
  }
}

/** Read bearer token from Authorization header or cookie. */
export function extractToken(event: H3Event): string | null {
  const header = getHeader(event, 'authorization')
  if (header?.startsWith('Bearer ')) return header.slice(7)
  const cookie = getCookie(event, 'admin_token')
  return cookie || null
}

/** Require an authenticated user; throws 401 if invalid. */
export function requireUser(event: H3Event): JwtPayload {
  const token = extractToken(event)
  if (!token) throw createError({ statusCode: 401, message: '未授权或登录已过期' })
  const payload = verifyToken(token)
  if (!payload) throw createError({ statusCode: 401, message: '登录已过期，请重新登录' })
  return payload
}

/** Require an admin user; throws 403 if not admin. */
export function requireAdmin(event: H3Event): JwtPayload {
  const u = requireUser(event)
  if (!u.isAdmin) throw createError({ statusCode: 403, message: '需要管理员权限' })
  return u
}
