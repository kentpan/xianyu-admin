/** Auth state shared across the app (Nuxt useState — SSR-friendly). */
import { verifyAuth, login as apiLogin, logout as apiLogout } from '~/api/auth'

export interface AuthUser {
  user_id: number
  username: string
  is_admin: boolean
  email?: string
}

export function useAuth() {
  const user = useState<AuthUser | null>('auth_user', () => null)
  const token = useState<string | null>('auth_token', () => null)
  const loading = useState<boolean>('auth_loading', () => false)
  const ready = useState<boolean>('auth_ready', () => false)

  const isAuthenticated = computed(() => !!token.value && !!user.value)
  const isAdmin = computed(() => !!user.value?.is_admin)

  function setAuth(t: string, u: AuthUser) {
    token.value = t
    user.value = u
  }
  function clearAuth() {
    token.value = null
    user.value = null
  }

  async function fetchUser() {
    try {
      const data = await verifyAuth()
      if (data?.authenticated) {
        user.value = {
          user_id: data.user_id,
          username: data.username,
          is_admin: data.is_admin,
          email: data.email,
        }
        // Token is in httpOnly cookie; keep a non-sensitive flag for client gating.
        token.value = 'cookie'
        return true
      }
      clearAuth()
      return false
    } catch {
      clearAuth()
      return false
    } finally {
      ready.value = true
    }
  }

  async function login(username: string, password: string) {
    const data = await apiLogin(username, password)
    setAuth(data.token, data.user)
    return data
  }

  async function logout() {
    try {
      await apiLogout()
    } catch {
      /* ignore */
    }
    clearAuth()
  }

  return {
    user,
    token,
    loading,
    ready,
    isAuthenticated,
    isAdmin,
    setAuth,
    clearAuth,
    fetchUser,
    login,
    logout,
  }
}
