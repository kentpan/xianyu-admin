import { useApi } from '~/composables/useApi'

export interface VerifyCodeRow {
  id: number
  code: string
  order_id: string
  item_id: string
  buyer_id: string
  cookie_id: string
  rule_id: number
  card_id: number
  status: 'unused' | 'used' | string
  used_at: string | null
  used_ip: string
  used_by_key_id: number
  used_by_key_name: string | null
  created_at: string
}

export interface VerifyCodePage {
  data: VerifyCodeRow[]
  total: number
  page: number
  pageSize: number
  stats: { total: number; used: number }
}

export function getVerifyCodes(params?: { page?: number; pageSize?: number; keyword?: string; status?: string }) {
  const q = new URLSearchParams()
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('pageSize', String(params.pageSize))
  if (params?.keyword) q.set('keyword', params.keyword)
  if (params?.status) q.set('status', params.status)
  const qs = q.toString()
  return useApi().get<VerifyCodePage>(`/api/verify-codes${qs ? `?${qs}` : ''}`)
}
