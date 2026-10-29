/**
 * SSR 服务端登录态检测与鉴权 (server-side route guard)。
 *
 * 初始导航在服务端执行本中间件:
 *   - useApi 内部通过 useRequestHeaders(['cookie']) 透传浏览器 Cookie,
 *     /api/auth/verify 与 /api/system/status 均在服务端完成 JWT 校验;
 *   - 未登录访问受保护页面 → 服务端直接 302 /login (响应到达浏览器前);
 *   - 已登录的鉴权结果经 useState payload 水合到客户端, 客户端导航复用同一状态;
 *   - /admin/* 页面在服务端校验 is_admin。
 *
 * Routes use relative app paths (e.g. '/install'); Nuxt's router resolves them
 * against app.baseURL ('/'), so the browser URL becomes '/install'.
 */
import { useAuth } from '~/composables/useAuth'
import { getSystemStatus } from '~/api/system'

export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = ['/login', '/register', '/install', '/disclaimer', '/about']
  const isPublic = publicPaths.some((p) => to.path === p || to.path.startsWith(p + '/'))

  const { ready, isAuthenticated, fetchUser, user } = useAuth()

  // Probe install status once
  const installed = useState<boolean | null>('sys_installed', () => null)
  if (installed.value === null) {
    try {
      const data = await getSystemStatus()
      installed.value = data.installed
    } catch {
      installed.value = false
    }
  }

  if (!installed.value) {
    if (to.path !== '/install') return navigateTo('/install')
    return
  }

  if (to.path === '/install') {
    return navigateTo('/dashboard')
  }

  if (isPublic) {
    if ((to.path === '/login' || to.path === '/register') && isAuthenticated.value) {
      return navigateTo('/dashboard')
    }
    return
  }

  if (!ready.value) {
    await fetchUser()
  }
  if (!isAuthenticated.value) {
    return navigateTo('/login')
  }

  // Admin-only app routes (xianyu-admin's internal '/admin/*' pages).
  if (to.path.startsWith('/admin/') && !user.value?.is_admin) {
    return navigateTo('/dashboard')
  }
})
