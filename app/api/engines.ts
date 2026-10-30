import { useApi } from '~/composables/useApi'

export interface EngineHealth {
  engine_active: boolean
  accounts: { id: string; state: string }[]
  uptime_seconds: number
  script_version: string
}

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
  /** 远程代理 = 登记地址 /health 实测；内置 = 心跳 60s 新鲜度；未登记地址时回退轮询心跳 */
  online: boolean
  /** 令牌轮询心跳是否新鲜（地址不可达但该项为 true → 地址填错或令牌被别的实例共用） */
  pull_online?: boolean
  /** /health 实测详情（探测成功时） */
  health?: EngineHealth | null
  /** /health 探测失败原因 */
  health_error?: string
  /** 内置引擎专用: 当前运行时能否真实承载 (cloudflare 无常驻进程 → false) */
  runtime_supported?: boolean
  last_seen_at: string | null
  last_status: string
}

export interface EnginesResponse {
  engines: EngineRow[]
  active_slug: string
  origin: string
  runtime: 'node' | 'cloudflare'
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
