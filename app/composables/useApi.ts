/**
 * useApi — unified fetch wrapper that:
 *  - prefixes API calls with the app basePath on the client (so requests route
 *    through the Next.js /admin/* proxy); on the server calls go direct to
 *    Nitro's /api/* (internal).
 *  - forwards the JWT cookie (credentials: include + SSR cookie passthrough)
 *  - unwraps the unified { success, code, message, data } envelope
 *  - throws ApiRequestError for non-success
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
  // Nuxt 4 mounts ALL routes (pages + API) under app.baseURL, so both SSR and
  // CSR API calls must be prefixed with basePath ('/xianyu').
  const basePath = config.public.basePath || ''

  function buildUrl(url: string): string {
    if (url.startsWith('http')) return url
    // url is like '/api/auth/login' → prefix with basePath
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
