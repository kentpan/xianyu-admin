import { useApi } from '~/composables/useApi'

export interface CardConsumeLogRow {
  id: number
  code_id: number
  code: string
  card_name: string
  order_id: string
  item_id: string
  buyer_id: string
  api_key_id: number
  api_key_name: string
  ip: string
  /** 消费结果: success=验证成功 / failed=验证失败 */
  result: 'success' | 'failed' | string
  message: string
  /** 来源: 被核销卡密为「卡密发货测试」生成时带 'test' 测试标签 */
  source: '' | 'test' | string
  created_at: string
}

export interface CardConsumeLogPage {
  data: CardConsumeLogRow[]
  total: number
  page: number
  pageSize: number
}

export function getCardConsumeLogs(params?: { page?: number; pageSize?: number; keyword?: string; result?: string }) {
  const q = new URLSearchParams()
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('pageSize', String(params.pageSize))
  if (params?.keyword) q.set('keyword', params.keyword)
  if (params?.result) q.set('result', params.result)
  const qs = q.toString()
  return useApi().get<CardConsumeLogPage>(`/api/card-consumes${qs ? `?${qs}` : ''}`)
}
