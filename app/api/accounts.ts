import { useApi } from '~/composables/useApi'

export interface Account {
  id: string
  value_preview: string
  auto_confirm: number
  remark: string
  pause_duration: number
  username: string
  created_at: string
  enabled: number
  keyword_count: number
  login_type?: string
  xianyu_uid?: string
  cookie_status_text?: string
  last_check_at?: string
}

export interface AccountHealth {
  id: string
  remark: string
  enabled: boolean
  autoConfirm: boolean
  keywordCount: number
  orderCount: number
  lastOrderAt: string | null
  aiEnabled: boolean
  healthScore: number
  healthLevel: 'good' | 'fair' | 'poor'
}

export interface AccountLite {
  id: string
  remark: string
}

export interface AccountDetail {
  cookie: {
    id: string
    value?: string
    remark?: string
    pause_duration?: number
    auto_confirm?: number
    username?: string
    password?: string
    show_browser?: boolean
  }
}

export interface CreateAccountPayload {
  id?: string
  value: string
  remark?: string
  pause_duration?: number
  auto_confirm?: boolean
  username?: string
  password?: string
  show_browser?: boolean
  login_type?: string
  xianyu_uid?: string
  avatar?: string
}

export interface UpdateAccountPayload {
  value?: string
  remark?: string
  pause_duration?: number
  auto_confirm?: boolean
  username?: string
  password?: string
  show_browser?: boolean
}

export function getAccounts() {
  return useApi().get<Account[]>('/api/accounts')
}

export function getAccountHealth() {
  return useApi().get<AccountHealth[]>('/api/accounts/health')
}

export function getAccount(id: string) {
  return useApi().get<AccountDetail>(`/api/accounts/${encodeURIComponent(id)}`)
}

export function createAccount(body: CreateAccountPayload) {
  return useApi().post<{ id: string }>('/api/accounts', body)
}

export function updateAccount(id: string, body: UpdateAccountPayload) {
  return useApi().put(`/api/accounts/${encodeURIComponent(id)}`, body)
}

export function deleteAccount(id: string) {
  return useApi().del(`/api/accounts/${encodeURIComponent(id)}`)
}

export function updateAccountStatus(id: string, enabled: boolean) {
  return useApi().put<{ enabled: number }>(`/api/accounts/${encodeURIComponent(id)}/status`, { enabled })
}

export function updateAccountAutoConfirm(id: string, auto_confirm: boolean) {
  return useApi().put<{ auto_confirm: number }>(`/api/accounts/${encodeURIComponent(id)}/auto-confirm`, { auto_confirm })
}

export function verifyCookie(id: string) {
  return useApi().post<{ valid: boolean; checkedAt: string }>(`/api/accounts/${encodeURIComponent(id)}/verify-cookie`)
}
