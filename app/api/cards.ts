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
