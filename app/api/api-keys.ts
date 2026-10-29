import { useApi } from '~/composables/useApi'

export interface ApiKeyRow {
  id: number
  name: string
  /** 明文返回 (后台可反复查看+复制) */
  api_key: string
  rate_limit_num: number
  rate_limit_window: number
  enabled: number
  /** 有效期 (UTC 字符串, null=永久) */
  expires_at: string | null
  total_calls: number
  total_success: number
  total_failed: number
  calls_24h: number
  last_used_at: string | null
  remark: string
  created_at: string
  updated_at: string
}

export interface ApiKeyPage {
  data: ApiKeyRow[]
  total: number
  page: number
  pageSize: number
}

export interface ApiKeyStats {
  totals: {
    total_calls: number
    total_success: number
    total_failed: number
    calls_24h: number
    last_used_at: string | null
  }
  hourly: { bucket: string; total: number; success: number }[]
  daily: { bucket: string; total: number; success: number }[]
}

export interface ApiKeyLogRow {
  id: number
  api_key_id: number
  endpoint: string
  success: number
  status_code: number
  message: string
  ip: string
  created_at: string
}

export function getApiKeys(params?: { page?: number; pageSize?: number; keyword?: string; enabled?: string }) {
  const q = new URLSearchParams()
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('pageSize', String(params.pageSize))
  if (params?.keyword) q.set('keyword', params.keyword)
  if (params?.enabled) q.set('enabled', params.enabled)
  const qs = q.toString()
  return useApi().get<ApiKeyPage>(`/api/api-keys${qs ? `?${qs}` : ''}`)
}

export function createApiKey(body: { name: string; rate_limit_num?: number; rate_limit_window?: number; enabled?: boolean; remark?: string; expires_at?: string | null }) {
  return useApi().post<{ id: number; api_key: string }>('/api/api-keys', body)
}

export function updateApiKey(id: number, body: Partial<{ name: string; rate_limit_num: number; rate_limit_window: number; enabled: boolean; remark: string; expires_at: string | null }>) {
  return useApi().put<{ id: number }>(`/api/api-keys/${id}`, body)
}

export function deleteApiKey(id: number) {
  return useApi().del<{ id: number }>(`/api/api-keys/${id}`)
}

export function regenerateApiKey(id: number) {
  return useApi().post<{ id: number; api_key: string }>(`/api/api-keys/${id}/regenerate`, {})
}

export function getApiKeyStats(id: number) {
  return useApi().get<ApiKeyStats>(`/api/api-keys/${id}/stats`)
}

export function getApiKeyLogs(id: number, params?: { page?: number; pageSize?: number }) {
  const q = new URLSearchParams()
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('pageSize', String(params.pageSize))
  const qs = q.toString()
  return useApi().get<{ data: ApiKeyLogRow[]; total: number; page: number; pageSize: number }>(`/api/api-keys/${id}/logs${qs ? `?${qs}` : ''}`)
}
