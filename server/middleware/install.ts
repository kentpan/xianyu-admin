/**
 * Install guard middleware.
 * If NOT installed (ADMIN_SECRET missing), every page/api except the install
 * flow & public assets is redirected to /install. Once installed, /install is
 * blocked (redirect to /dashboard).
 */
const ALLOWED_PREFIXES = [
  '/install',
  '/api/install',
  '/api/system/status',
  '/api/health',
  '/_nuxt',
  '/assets',
  '/favicon',
]

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const pathname = url.pathname

  const installed = isInstalled()

  if (!installed) {
    // 精确匹配或前缀匹配（前缀需以 / 分隔或以 . 分隔，如 /favicon.ico），避免 /install 误匹配 /installation
    const allowed = ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '.'))
    if (!allowed) {
      if (pathname.startsWith('/api/')) {
        setResponseStatus(event, 503)
        return { success: false, code: 503, message: '系统未安装，请先完成安装向导' }
      }
      // baseURL is '/', so the install page lives at /install
      return sendRedirect(event, '/install', 302)
    }
    return
  }

  if (pathname === '/install' || pathname.startsWith('/install/')) {
    return sendRedirect(event, '/dashboard', 302)
  }
})
