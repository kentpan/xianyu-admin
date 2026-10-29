import { useApi } from '~/composables/useApi'

/** 监听引擎状态 (server/api/listener) */
export interface ListenerAccount {
  id: string
  remark: string
  username: string
  enabled: boolean
  state: 'listening' | 'connecting' | 'reconnecting' | 'risk_cooldown' | 'error' | 'need_relogin' | 'engine_offline' | 'disabled'
  status_text: string
  last_check_at: string | null
  /** IM token 连续失败次数 (成功清零, 仅引擎运行中账号有值) */
  token_fail_streak?: number
  /** 连败 ≥2 且持有验证页链接 → 建议全局弹窗人工滑块 */
  need_manual_verify?: boolean
}

export interface ListenerStatus {
  engine_online: boolean
  managed: number
  listening: number
  connecting: number
  need_relogin: number
  errored: number
  settings: Record<string, string>
  accounts: ListenerAccount[]
  /** 需要人工滑块验证的账号清单 (全局弹窗数据源) */
  verify_needed: { id: string; remark: string; username: string; streak: number }[]
}

export function getListenerStatus() {
  return useApi().get<ListenerStatus>('/api/listener/status')
}

/** 手动获取 IM token 的真实结果 */
export interface ManualTokenResult {
  ok: boolean
  verdict: 'ok' | 'risk' | 'auth' | 'token_roll' | 'unknown'
  ret: string
  message: string
  /** 风控挑战页链接 (verdict=risk 时存在), 供弹窗直接 iframe 加载官方验证页 */
  punish_url: string
  account: string
  label: string
}

/** 手动获取 IM token: 绕过引擎冷却立即实调一次, 返回平台真实返回 */
export function manualFetchToken(cookieId: string) {
  return useApi().post<ManualTokenResult>('/api/listener/manual-token', { cookieId })
}

/** 接收官方验证页 postMessage 回传的 x5sec: 服务端合并进账号 Cookie 并实调 token 验证赎回 */
export function postVerifyX5sec(cookieId: string, x5sec: string) {
  return useApi().post<ManualTokenResult>('/api/listener/verify-x5sec', { cookieId, x5sec })
}

/** 滑块验证弹窗打开时读一次本地进程内状态 (数据库 + 内存, 零闲鱼请求, 非轮询) */
export interface VerifyStateInfo {
  cookie_id: string
  label: string
  state: string
  streak: number
  punish_url: string
  last_ret: string
  last_at: number
  x5sec_present: boolean
}

export function getVerifyState(cookieId: string) {
  return useApi().get<VerifyStateInfo>(`/api/listener/verify-state?cookieId=${encodeURIComponent(cookieId)}`)
}

/** 人工验证持有期开关: on=弹窗打开(引擎对该账号静默), off=关闭/成功(恢复) */
export function postVerifyHold(cookieId: string, on: boolean) {
  return useApi().post<{ cookie_id: string; hold: boolean }>('/api/listener/verify-hold', { cookieId, on })
}
