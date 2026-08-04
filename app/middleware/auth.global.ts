/**
 * Client-side route guard.
 * - If not installed → force /install (server also enforces this).
 * - If installed but not authenticated → redirect to /login (except public pages).
 * - If authenticated but visits /login → redirect to /dashboard.
 *
 * Routes use relative app paths (e.g. '/install'); Nuxt's router resolves them
 * against app.baseURL ('/admin/'), so the browser URL becomes '/admin/install'.
 */
import { useAuth } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = ['/login', '/register', '/install', '/disclaimer', '/about']
  const isPublic = publicPaths.some((p) => to.path === p || to.path.startsWith(p + '/'))

  const { ready, isAuthenticated, fetchUser, user } = useAuth()

  // Probe install status once
  const installed = useState<boolean | null>('sys_installed', () => null)
  if (installed.value === null) {
    try {
      const api = useApi()
      const data = await api.get<{ installed: boolean }>('/api/system/status')
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
