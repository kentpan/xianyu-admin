import { useApi } from '~/composables/useApi'

export interface VerifyAuthResponse {
  authenticated: boolean
  user_id: number
  username: string
  is_admin: boolean
  email?: string
  userId?: number
  isAdmin?: boolean
}

export interface LoginResponse {
  token: string
  user: {
    user_id: number
    username: string
    is_admin: boolean
    email?: string
  }
}

export function verifyAuth() {
  return useApi().get<VerifyAuthResponse>('/api/auth/verify')
}

export function login(username: string, password: string) {
  return useApi().post<LoginResponse>('/api/auth/login', { username, password })
}

export function logout() {
  return useApi().post('/api/auth/logout')
}

export function changePassword(currentPassword: string, newPassword: string) {
  return useApi().post('/api/auth/change-password', { currentPassword, newPassword })
}
