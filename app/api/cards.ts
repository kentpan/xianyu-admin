import { useApi } from '~/composables/useApi'

export interface Card {
  id: number
  name: string
  type: 'api' | 'text' | 'code' | 'data' | 'image'
  api_config: string | null
  text_content: string | null
  data_content: string | null
  image_url: string | null
  /** 卡密生成配置 (code 型) */
  code_length: number
  code_letters: number
  code_digits: number
  code_case: string
  code_template: string | null
  description: string | null
  enabled: number
  delay_seconds: number
  is_multi_spec: number
  spec_name: string | null
  spec_value: string | null
  price: string | null
  is_dockable: number
  fee_payer: string | null
  min_price: string | null
  dock_visibility: string | null
  created_at: string
}

export interface CardLite {
  id: number
  name: string
  type: string
}

export interface CreateCardPayload {
  name: string
  type: string
  description?: string
  enabled?: boolean
  delay_seconds?: number
  is_multi_spec?: boolean
  spec_name?: string
  spec_value?: string
  price?: string
  is_dockable?: boolean
  fee_payer?: string
  min_price?: string | null
  dock_visibility?: string
  api_config?: string
  text_content?: string
  data_content?: string
  image_url?: string
  code_length?: number
  code_letters?: boolean | number
  code_digits?: boolean | number
  code_case?: string
  code_template?: string
}

export type UpdateCardPayload = Partial<CreateCardPayload>

export function getCards() {
  return useApi().get<Card[]>('/api/cards')
}

export function createCard(body: CreateCardPayload) {
  return useApi().post<{ id: number }>('/api/cards', body)
}

export function updateCard(id: number, body: UpdateCardPayload) {
  return useApi().put(`/api/cards/${id}`, body)
}

export function toggleCardEnabled(id: number, enabled: boolean) {
  return useApi().put(`/api/cards/${id}`, { enabled })
}

export function deleteCard(id: number) {
  return useApi().del(`/api/cards/${id}`)
}

export interface DeliverTestItem {
  code: string
  /** 渲染后的发货文案 (与真实发货发出的内容一致) */
  text: string
  preview: string
  /** 是否已入库 (source='test'): 入库后可用消费 API 真实核销 */
  persisted: boolean
}

export interface DeliverTestResult {
  card_id: number
  card_name: string
  count: number
  /** 本次测试批次的订单号 (TEST- 前缀, 便于在生成/消费记录中定位) */
  order_id: string
  /** 实际成功入库的份数 */
  persisted_count: number
  items: DeliverTestItem[]
  config: { length: number; letters: boolean; digits: boolean; case: string; template: string }
  note: string
}

/** 卡密发货测试: 与真实发货同一生成链路并入库 (带测试标签), 可用消费 API 真实核销; 不真实发货 */
export function deliverTestCard(body: { card_id: number; count?: number }) {
  return useApi().post<DeliverTestResult>('/api/cards/deliver-test', body)
}
