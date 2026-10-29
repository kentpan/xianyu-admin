import { useApi } from '~/composables/useApi'

export interface AuditLog {
  id: number
  user_id: number | null
  username: string | null
  action: string
  module: string | null
  target_type: string | null
  target_id: string | null
  description: string | null
  ip_address: string | null
  created_at: string
}

export interface AuditQuery {
  page?: number
  pageSize?: number
  action?: string
  module?: string
  keyword?: string
}

export interface AuditLogListResponse {
  data: AuditLog[]
  total: number
  actions: string[]
  modules: string[]
}

export function getAuditLogs(query: AuditQuery = {}) {
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = String(v)
        return acc
      }, {}),
  ).toString()
  return useApi().get<AuditLogListResponse>(`/api/audit/logs?${qs}`)
}
