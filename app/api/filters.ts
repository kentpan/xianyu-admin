import { useApi } from '~/composables/useApi'

/** 消息过滤规则 (message_filters, 引擎收消息时即时生效) */
export interface MessageFilter {
  id: number
  cookie_id: string
  keyword: string
  filter_type: 'skip_reply' | 'skip_notify'
  enabled: number
  created_at: string
  updated_at: string
}

export function getFilters(cookieId?: string) {
  const q = cookieId ? `?cookie_id=${encodeURIComponent(cookieId)}` : ''
  return useApi().get<MessageFilter[]>(`/api/filters${q}`)
}

export function createFilter(body: { cookie_id: string; keyword: string; filter_type: string; enabled?: boolean }) {
  return useApi().post('/api/filters', body)
}

export function updateFilter(id: number, body: { keyword?: string; filter_type?: string; enabled?: boolean }) {
  return useApi().put(`/api/filters/${id}`, body)
}

export function deleteFilter(id: number) {
  return useApi().del(`/api/filters/${id}`)
}
