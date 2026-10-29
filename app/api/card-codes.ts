import { useApi } from '~/composables/useApi'

export interface CardCodeLogRow {
  id: number
  card_id: number
  card_name: string
  code: string
  cookie_id: string
  item_id: string
  order_id: string
  buyer_id: string
  /** 核销状态: unused=未核销 / used=已核销 */
  status: 'unused' | 'used' | string
  used_at: string | null
  used_ip: string
  used_by_key_id: number
  created_at: string
}

export interface CardCodeLogPage {
  data: CardCodeLogRow[]
  total: number
  page: number
  pageSize: number
}

export function getCardCodeLogs(params?: { page?: number; pageSize?: number; keyword?: string; cardId?: number }) {
  const q = new URLSearchParams()
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('pageSize', String(params.pageSize))
  if (params?.keyword) q.set('keyword', params.keyword)
  if (params?.cardId) q.set('cardId', String(params.cardId))
  const qs = q.toString()
  return useApi().get<CardCodeLogPage>(`/api/card-codes${qs ? `?${qs}` : ''}`)
}
