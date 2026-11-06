import { useApi } from '~/composables/useApi'

export interface ItemAiSettings {
  cookie_id: string
  item_id: string
  ai_enabled: number
  /** 引用 AI 配置中心条目 (0=未引用, 遗留行内字段兜底) */
  ai_config_id: number
  model_name: string
  /** 服务端已配置过 API Key (前端显示掩码, 留空保存则保留原值) */
  api_key?: string
  api_key_masked?: boolean
  base_url: string
  max_discount_percent: number
  max_discount_amount: number
  max_bargain_rounds: number
  custom_prompts: string | null
}

export interface SaveItemAiSettingsPayload {
  cookie_id: string
  item_id: string
  ai_enabled: boolean | number
  ai_config_id: number
  max_discount_percent: number
  max_discount_amount: number
  max_bargain_rounds: number
  custom_prompts: string
}

export function getItemAiSettings(cookieId: string, itemId: string) {
  const params = new URLSearchParams({ cookie_id: cookieId, item_id: itemId })
  return useApi().get<ItemAiSettings>(`/api/item-ai-settings?${params}`)
}

export function saveItemAiSettings(body: SaveItemAiSettingsPayload) {
  return useApi().put<{ cookie_id: string; item_id: string; ai_enabled: number }>('/api/item-ai-settings', body)
}
