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

/** AI 调试面板数据 (原始请求/响应, 排查「未返回内容」) */
export interface AiTestDebug {
  url: string
  status: number
  elapsed_ms: number
  request_body: string
  response_body: string
  error: string
}

export interface AiTestResult {
  ok: boolean
  reply: string
  model: string
  error: string
  debug?: AiTestDebug
}

/** AI 配置连通性测试 (与引擎同一条 callAiApi 分派链路, 不落库; 失败也返回 200 + debug 面板数据) */
export function testAiConfig(id: number, message?: string) {
  return useApi().post<AiTestResult>('/api/ai-configs/test', { id, message })
}
