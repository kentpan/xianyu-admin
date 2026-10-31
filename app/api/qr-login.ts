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
  /** 风控二次核验页链接 (passport 官方页, 前端按钮新开顶部标签页打开完成人脸/滑块核验) */
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
