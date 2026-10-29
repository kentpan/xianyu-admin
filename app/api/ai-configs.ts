import { useApi } from '~/composables/useApi'

export interface AiConfig {
  id: number
  name: string
  model_name: string
  /** 出参不回传明文 Key, 仅表示是否已配置 */
  has_api_key?: number
  api_key_masked?: boolean
  base_url: string
  enabled: number
  remark: string
  created_at?: string
  updated_at?: string
}

export interface AiConfigPage {
  data: AiConfig[]
  total: number
  page: number
  pageSize: number
}

export interface SaveAiConfigPayload {
  name: string
  model_name: string
  api_key?: string
  base_url?: string
  enabled?: boolean | number
  remark?: string
}

/** 分页列表 (page_size 默认 20; 下拉数据源可传 page_size=200 一次取全) */
export function getAiConfigs(params?: { page?: number; pageSize?: number; keyword?: string; enabled?: string }) {
  const q = new URLSearchParams()
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('pageSize', String(params.pageSize))
  if (params?.keyword) q.set('keyword', params.keyword)
  if (params?.enabled) q.set('enabled', params.enabled)
  const qs = q.toString()
  return useApi().get<AiConfigPage>(`/api/ai-configs${qs ? `?${qs}` : ''}`)
}

export function createAiConfig(body: SaveAiConfigPayload) {
  return useApi().post<{ id: number }>('/api/ai-configs', body)
}

export function updateAiConfig(id: number, body: SaveAiConfigPayload) {
  return useApi().put<{ id: number }>(`/api/ai-configs/${id}`, body)
}

export function deleteAiConfig(id: number) {
  return useApi().del<{ id: number }>(`/api/ai-configs/${id}`)
}

/** AI 配置连通性测试 (与引擎同一条 callAiApi 分派链路, 不落库) */
export function testAiConfig(id: number, message?: string) {
  return useApi().post<{ reply: string; model: string }>('/api/ai-configs/test', { id, message })
}
