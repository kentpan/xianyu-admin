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
  /** v2.3.0: AI 回复时引用本商品历史真实对话作为上下文 (0/1) */
  use_item_kb?: number
  /** v2.3.0: 商品历史对话样本不限当前账号, 多账号聚合 (0/1, 依赖 use_item_kb) */
  share_item_kb?: number
  /** v2.3.0: AI 语气/用语与该账号历史回复保持一致 (0/1) */
  use_account_style?: number
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
  /** v2.3.0 三开关: 布尔或 0/1 均可 (后端兼容) */
  use_item_kb?: number | boolean
  share_item_kb?: number | boolean
  use_account_style?: number | boolean
}

export function getItemAiSettings(cookieId: string, itemId: string) {
  const params = new URLSearchParams({ cookie_id: cookieId, item_id: itemId })
  return useApi().get<ItemAiSettings>(`/api/item-ai-settings?${params}`)
}

export function saveItemAiSettings(body: SaveItemAiSettingsPayload) {
  return useApi().put<{ cookie_id: string; item_id: string; ai_enabled: number }>('/api/item-ai-settings', body)
}
