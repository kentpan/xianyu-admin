/**
 * Unified API Response Format
 *
 * Every server API returns:
 *   { success: boolean, code: number, message: string, data?: T }
 *
 * - success: business outcome
 * - code:    HTTP-like status code (200/400/401/403/404/500)
 * - message: human-readable message (i18n-ready)
 * - data:    optional payload
 *
 * Use `ok()` / `fail()` helpers in handlers; throw `ApiError` for non-200.
 */
import type { H3Event } from 'h3'

export interface ApiResponse<T = any> {
  success: boolean
  code: number
  message: string
  data?: T
}

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: any,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function ok<T = any>(data: T, message = '操作成功'): ApiResponse<T> {
  return { success: true, code: 200, message, data }
}

export function fail(message = '操作失败', code = 400, data?: any): ApiResponse {
  return { success: false, code, message, data }
}

export function notFound(message = '资源不存在'): ApiResponse {
  return { success: false, code: 404, message }
}

export function unauthorized(message = '未授权或登录已过期'): ApiResponse {
  return { success: false, code: 401, message }
}

export function forbidden(message = '无权限访问'): ApiResponse {
  return { success: false, code: 403, message }
}

/** Wrap an async handler, normalising success/errors into the unified shape. */
export function withApi<T = any>(
  fn: (event: H3Event) => Promise<T>,
): (event: H3Event) => Promise<ApiResponse<T>> {
  return async (event: H3Event) => {
    try {
      const data = await fn(event)
      // If handler already returns an ApiResponse shape, pass through
      if (data && typeof data === 'object' && 'success' in data && 'code' in data) {
        return data as ApiResponse<T>
      }
      return ok(data)
    } catch (e: any) {
      // 服务端留痕 (Cloudflare wrangler tail / node 日志可直接看到真实原因)
      try {
        console.error(`[api] ${event?.path || '-'} → ${e?.statusCode || 500}:`, e?.message || e)
      } catch {}
      if (e instanceof ApiError) {
        setResponseStatus(event, e.code)
        return { success: false, code: e.code, message: e.message, data: e.data }
      }
      const code = e.statusCode || 500
      setResponseStatus(event, code)
      return {
        success: false,
        code,
        message: e.message || '服务器内部错误',
      }
    }
  }
}
