import { useApi } from '~/composables/useApi'

export interface EngineRow {
  id: number
  slug: string
  name: string
  type: 'builtin' | 'remote'
  host: string
  port: number
  token: string
  remark: string
  enabled: boolean
  is_active: boolean
  online: boolean
  last_seen_at: string | null
  last_status: string
}

export interface EnginesResponse {
  engines: EngineRow[]
  active_slug: string
  origin: string
}

export function getEngines() {
  return useApi().get<EnginesResponse>('/api/engines')
}

export interface EngineInput {
  name: string
  host?: string
  port?: number
  remark?: string
  enabled?: boolean
}

export function createEngine(input: EngineInput) {
  return useApi().post<EngineRow>('/api/engines', input)
}

export function updateEngine(id: number, input: Partial<EngineInput & { regenerate_token?: boolean }>) {
  return useApi().put<EngineRow>(`/api/engines/${id}`, input)
}

export function deleteEngine(id: number) {
  return useApi().del(`/api/engines/${id}`)
}

export function activateEngine(id: number) {
  return useApi().post<{ active_slug: string; active_name: string }>(`/api/engines/${id}/activate`)
}
