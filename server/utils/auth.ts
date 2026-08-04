/**
 * Auth utilities: JWT issuing/verification + password hashing.
 * All secrets come from runtime config (env), never hard-coded.
 */
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import type { H3Event } from 'h3'
import { createError } from 'h3'

export interface JwtPayload {
  userId: number
  username: string
  isAdmin: boolean
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
  return jwt.sign(payload, secret, { expiresIn: '7d' })
}

export function verifyToken(token: string): JwtPayload | null {
  const secret = getRuntimeState().jwtSecret
  if (!secret) return null
  try {
    return jwt.verify(token, secret) as JwtPayload
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
