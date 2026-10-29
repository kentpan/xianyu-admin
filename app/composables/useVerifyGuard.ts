/**
 * useVerifyGuard — 风控手动验证全局弹窗状态 (官方验证页 iframe 直连模式)。
 *
 * 触发约定: IM token 连败 ≥2 次且持有风控挑战链接时 (用户约定失败 2 次即弹),
 * VerifySliderModal 自动弹出; 弹窗内直接 iframe 加载闲鱼官方验证页
 * (punishUrl + addCookieToHeader=1), 用户人工拖滑块, 通过后官方页面把 x5sec
 * 凭证 postMessage 回父窗口, 合并进账号后重试 token。用户点「稍后再说」后
 * 30 分钟内该账号不再自动弹 (localStorage 记录), 可随时手动再开。
 */
export interface VerifyModalState {
  open: boolean
  cookieId: string
  label: string
  punishUrl: string
  /** 会话重建键 (重开弹窗/重启会话/刷新画面时 +1) */
  sessionKey: number
}

const DISMISS_TTL_MS = 30 * 60 * 1000

export function useVerifyGuard() {
  const state = useState<VerifyModalState>('xy_verify_modal', () => ({
    open: false,
    cookieId: '',
    label: '',
    punishUrl: '',
    sessionKey: 0,
  }))

  function openVerify(cookieId: string, label: string, punishUrl = '') {
    state.value = { open: true, cookieId, label, punishUrl, sessionKey: state.value.sessionKey + 1 }
  }

  function closeVerify() {
    state.value = { ...state.value, open: false }
  }

  /** 更新挑战链接 (重试 Token 换新挑战后) 或重开会话 */
  function refreshFrame(punishUrl?: string) {
    state.value = {
      ...state.value,
      punishUrl: punishUrl || state.value.punishUrl,
      sessionKey: state.value.sessionKey + 1,
    }
  }

  function dismiss(cookieId: string) {
    if (import.meta.client) {
      try {
        localStorage.setItem(`xy_verify_dismiss_${cookieId}`, String(Date.now()))
      } catch {}
    }
    closeVerify()
  }

  function recentlyDismissed(cookieId: string): boolean {
    if (!import.meta.client) return false
    try {
      const t = Number(localStorage.getItem(`xy_verify_dismiss_${cookieId}`) || 0)
      return t > 0 && Date.now() - t < DISMISS_TTL_MS
    } catch {
      return false
    }
  }

  return { state, openVerify, closeVerify, refreshFrame, dismiss, recentlyDismissed }
}
