/**
 * useApi — 统一 fetch 封装:
 *  - 自动加 runtimeConfig.public.basePath 前缀 (主服务器为空, 部署到子路径时统一变量)
 *  - 转发 JWT cookie (credentials: include + SSR cookie 透传)
 *  - 解包统一 { success, code, message, data } 响应
 *  - 非 success 抛出 ApiRequestError
 *
 * basePath 来自 runtimeConfig.public.basePath (nuxt.config.ts), 默认空 = 根路径。
 * 部署到子路径时只需改这一个变量, 前端无需改动。
 *
 * 所有 API 路径字符串应集中在 app/api/ 模块中定义, 组件 import 调用, 避免硬编码散落。
 */
export interface ApiResult<T = any> {
  success: boolean
  code: number
  message: string
  data?: T
}

export class ApiRequestError extends Error {
  code: number
  data?: any
  constructor(message: string, code: number, data?: any) {
    super(message)
    this.code = code
    this.data = data
    this.name = 'ApiRequestError'
  }
}

export function useApi() {
  const config = useRuntimeConfig()
  const basePath = config.public.basePath || ''

  function buildUrl(url: string): string {
    if (url.startsWith('http')) return url
    if (basePath && url.startsWith('/')) return basePath + url
    return url
  }

  async function request<T = any>(
    url: string,
    options: any = {},
  ): Promise<T> {
    const fullUrl = buildUrl(url)

    // SSR cookie forwarding: $fetch's `credentials: 'include'` does NOT forward
    // the incoming request's cookies on the server. Manually pass the Cookie
    // header through so server-side middleware can call /api/auth/verify.
    const headers: Record<string, string> = { ...(options.headers || {}) }
    if (import.meta.server) {
      const reqHeaders = useRequestHeaders(['cookie'])
      if (reqHeaders.cookie) headers.cookie = reqHeaders.cookie
    }

    const res = await $fetch<ApiResult<T>>(fullUrl, {
      ...options,
      headers,
      credentials: 'include',
      baseURL: '',
      onResponseError({ response }) {
        const body = response._data
        if (body && typeof body === 'object' && 'message' in body) {
          throw new ApiRequestError(body.message || '请求失败', body.code || response.status, body.data)
        }
      },
    })

    if (res && typeof res === 'object' && 'success' in res) {
      if (!res.success) {
        throw new ApiRequestError(res.message || '操作失败', res.code || 400, res.data)
      }
      return res.data as T
    }
    return res as T
  }

  return {
    get: <T = any>(url: string, opts: any = {}) => request<T>(url, { method: 'GET', ...opts }),
    post: <T = any>(url: string, body?: any, opts: any = {}) => request<T>(url, { method: 'POST', body, ...opts }),
    put: <T = any>(url: string, body?: any, opts: any = {}) => request<T>(url, { method: 'PUT', body, ...opts }),
    del: <T = any>(url: string, opts: any = {}) => request<T>(url, { method: 'DELETE', ...opts }),
    request,
  }
}
