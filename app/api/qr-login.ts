import { useApi } from '~/composables/useApi'

export interface QrLoginStartResponse {
  sessionKey: string
  qrUrl: string
}

export interface QrLoginStatusResponse {
  status: string
  xianyuUid?: string
  xianyuNick?: string
  cookieValue?: string
  /** 风控二次核验页链接 (passport 官方页, 手机闲鱼 App 内打开可带登录态完成核验) */
  iframeRedirectUrl?: string
}

export function startQrLogin() {
  return useApi().post<QrLoginStartResponse>('/api/xianyu/qr-login/start')
}

export function pollQrStatus(sessionKey: string) {
  return useApi().get<QrLoginStatusResponse>(
    `/api/xianyu/qr-login/status?sessionKey=${encodeURIComponent(sessionKey)}`,
  )
}

export function cancelQrLogin(sessionKey: string) {
  return useApi().post('/api/xianyu/qr-login/cancel', { sessionKey })
}
