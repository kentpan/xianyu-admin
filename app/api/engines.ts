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
  /** 回连核验：心跳新鲜且来源 IP 与登记 host 一致（探测失败时的在线兜底判定源） */
  poll_verified?: boolean
  /** 最近一次回连来源 IP（cf-connecting-ip/XFF） */
  poll_ip?: string
  /** /health 实测详情（探测成功时） */
  health?: EngineHealth | null
  /** /health 探测失败原因 */
  health_error?: string
  /** 内置引擎专用: 当前运行时能否真实承载 (cloudflare 无常驻进程 → false) */
  runtime_supported?: boolean
  /** 代理配置轮询实际打到的站点 host (共库多站点判定用) */
  poll_host?: string
  /** 代理在服务别的站点 (轮询目标 ≠ 本站): 本站收不到任何监听数据, 展示为未连接本站 */
  poll_host_mismatch?: boolean
  last_seen_at: string | null
  last_status: string
}

export interface EnginesResponse {
  engines: EngineRow[]
  active_slug: string
  origin: string
  runtime: 'node' | 'cloudflare'
  /** 内置引擎是否处于手动停止状态 (开关持久化在数据库, 重启进程后保持) */
  builtin_disabled?: boolean
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

/** 手动停止内置监听引擎 (开关持久化, 重启进程后保持停止; 远程代理授权立即归还) */
export function stopBuiltinEngine() {
  return useApi().post<{ disabled: boolean }>('/api/engines/builtin-stop')
}

/** 解除内置引擎手动停止 (巡检恢复, 是否接管仍按引擎切换状态与失联仲裁决定) */
export function startBuiltinEngine() {
  return useApi().post<{ disabled: boolean }>('/api/engines/builtin-start')
}
