/**
 * SSR 服务端登录态检测与鉴权 (server-side route guard)。
 *
 * 初始导航在服务端执行本中间件:
 *   - useApi 内部通过 useRequestHeaders(['cookie']) 透传浏览器 Cookie,
 *     /api/auth/verify 与 /api/system/status 均在服务端完成 JWT 校验;
 *   - 未登录访问受保护页面 → 服务端直接 302 /login (响应到达浏览器前);
 *   - 已登录的鉴权结果经 useState payload 水合到客户端, 客户端导航复用同一状态;
 *   - /admin/* 页面在服务端校验 is_admin;
 *   - (v2.1.14) RBAC 菜单级权限: 登录后服务端拉取 /api/auth/menus (按角色过滤),
 *     非管理员访问不在其可见菜单内的路径 → 服务端 302 /dashboard;
 *     菜单列表同时经 useState 注水, 侧边栏 SSR 首屏按权限渲染。
 *
 * Routes use relative app paths (e.g. '/install'); Nuxt's router resolves them
 * against app.baseURL ('/'), so the browser URL becomes '/install'.
 */
import { useAuth } from '~/composables/useAuth'
import { useRbac } from '~/composables/useRbac'
import { getSystemStatus } from '~/api/system'

export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = ['/login', '/register', '/install', '/disclaimer', '/about']
  const isPublic = publicPaths.some((p) => to.path === p || to.path.startsWith(p + '/'))

  const { ready, isAuthenticated, fetchUser, user } = useAuth()
  const { fetchMenus, pathAllowed, ready: rbacReady } = useRbac()

  // Probe install status once
  const installed = useState<boolean | null>('sys_installed', () => null)
  if (installed.value === null) {
    try {
      const data = await getSystemStatus()
      installed.value = data.installed
    } catch {
      // (v2.3.5 hotfix) 探测失败绝不伪装成未安装: 网络/D1 暂态故障(如日读限额
      // 用尽)时按「已安装」放行, 页面自身 API 错误如实展示 —— 否则全站会被 302
      // 到 /install, 用户误以为数据库丢失。仅当接口明确返回 installed:false 才进安装向导。
      installed.value = true
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

  // (v2.1.14) RBAC 菜单级权限 (SSR 服务端校验): 可见菜单已在服务端按角色过滤,
  // 命中菜单路径或其子路径才放行; 工作台永远可达 (防 302 自循环)。
  if (!rbacReady.value) await fetchMenus()
  if (!user.value?.is_admin && !pathAllowed(to.path) && to.path !== '/dashboard') {
    return navigateTo('/dashboard')
  }
})
