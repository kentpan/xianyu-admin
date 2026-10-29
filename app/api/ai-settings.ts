import { useApi } from '~/composables/useApi'

export interface AiReplySettings {
  cookie_id: string
  ai_enabled: number
  /** 引用 AI 配置中心条目 (0=未引用, 遗留行内字段兜底) */
  ai_config_id: number
  model_name: string
  api_key: string
  /** 服务端已配置过 API Key (前端显示掩码, 留空保存则保留原值) */
  api_key_masked?: boolean
  base_url: string
  max_discount_percent: number
  max_discount_amount: number
  max_bargain_rounds: number
  custom_prompts: string | null
  created_at?: string
  updated_at?: string
}

export interface SaveAiReplySettingsPayload {
  ai_enabled: boolean | number
  ai_config_id: number
  model_name: string
  api_key: string
  base_url: string
  max_discount_percent: number
  max_discount_amount: number
  max_bargain_rounds: number
  custom_prompts: string
}

export function getAiSettings(cookieId: string) {
  return useApi().get<AiReplySettings>(`/api/ai-settings/${encodeURIComponent(cookieId)}`)
}

export function saveAiSettings(cookieId: string, body: SaveAiReplySettingsPayload) {
  return useApi().put<{ cookie_id: string; ai_enabled: number }>(
    `/api/ai-settings/${encodeURIComponent(cookieId)}`,
    body,
  )
}

export interface AiTestPayload {
  cookie_id: string
  message: string
  item_title?: string
  item_price?: string
  item_desc?: string
}

/** AI 回复配置连通性测试 (与引擎同一提示词组装, 不落库) */
export function testAiSettings(payload: AiTestPayload) {
  return useApi().post<{ reply: string; model: string }>('/api/ai-settings/test', payload)
}
