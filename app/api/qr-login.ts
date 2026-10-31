import { useApi } from '~/composables/useApi'

export interface QrLoginStartResponse {
  sessionKey: string
  /** 服务端渲染的二维码 PNG data-url, <img :src> 直显 */
  qrUrl: string
}

export interface QrLoginStatusResponse {
  status: string
  xianyuUid?: string
  xianyuNick?: string
  cookieValue?: string
  errorMessage?: string
  /** 需身份核验时: 服务端自动跟随核验链提取的人脸验证二维码 (手机闲鱼 App 扫码) */
  faceQrUrl?: string
}

export function startQrLogin() {
  return useApi().post<QrLoginStartResponse>('/api/xianyu/qr-login/start')
}

export function pollQrStatus(sessionKey: string, signal?: AbortSignal) {
  return useApi().get<QrLoginStatusResponse>(
    `/api/xianyu/qr-login/status?sessionKey=${encodeURIComponent(sessionKey)}`,
    { signal },
  )
}

export function cancelQrLogin(sessionKey: string) {
  return useApi().post('/api/xianyu/qr-login/cancel', { sessionKey })
}
