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
  // 引擎回连接口 (v2.3.8): 独立代理 (scripts/xianyu-proxy.mjs) 的保活回连
  // (config/events/tasks) 走独立 Bearer 引擎令牌鉴权 (requireEngine), 与登录态无关;
  // 未安装时令牌校验必然失败, install 门对它没有存在意义 —— 不加白会把代理回连打成
  // 503「系统未安装」, 保活定时器链断裂 → cookie2/skt 短登录 ~24h 必死 (账号每天过期
  // 需重登+人脸核验) + cookie 轮换上报丢失 → 自动发货整链静默中断。
  '/api/engine',
  '/_nuxt',
  '/assets',
  '/favicon',
]

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const pathname = url.pathname

  // 数据真源判定: 环境变量之外, 库中存在可用管理员即视为已安装
  // (CI 全量导入含 admin 用户的本地库后, 线上无需 XY_INSTALLED 注入)
  const installed = await isInstalledAsync(event)
  if (installed) {
    // 保证 JWT/管理密钥就位(登录签发、鉴权校验依赖; env 未注入时从库兜底加载)
    await ensureSecrets(event)
  }

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
