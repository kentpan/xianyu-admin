import { useApi } from '~/composables/useApi'

export interface UserProfileResponse {
  user: any
  preferences: any
}

export interface DockCodeResponse {
  dock_code: string
}

export interface SecretKeyResponse {
  secret_key: string
}

export interface PaymentInfoResponse {
  payment_type: string
  payment_qrcode: string
  alipay_id: string
}

export interface FundFlowLite {
  id: number
  type: string
  amount: string
  balance_before: string
  balance_after: string
  description: string | null
  created_at: string
}

export interface UserBalanceResponse {
  balance: string
  recent_flows: FundFlowLite[]
}

export interface UpdatePaymentInfoPayload {
  payment_type?: string
  payment_qrcode?: string
  alipay_id?: string
}

export function getUserProfile() {
  return useApi().get<UserProfileResponse>('/api/user/profile')
}

export function updateUserProfile(preferences: any) {
  return useApi().put('/api/user/profile', { preferences })
}

export function getDockCode() {
  return useApi().get<DockCodeResponse>('/api/user/dock-code')
}

export function resetDockCode() {
  return useApi().post<DockCodeResponse>('/api/user/dock-code/reset')
}

export function getSecretKey() {
  return useApi().get<SecretKeyResponse>('/api/user/secret-key')
}

export function resetSecretKey() {
  return useApi().post<SecretKeyResponse>('/api/user/secret-key/reset')
}

export function getUserBalance() {
  return useApi().get<UserBalanceResponse>('/api/user/balance')
}

export function getPaymentInfo() {
  return useApi().get<PaymentInfoResponse>('/api/user/payment-info')
}

export function updatePaymentInfo(body: UpdatePaymentInfoPayload) {
  return useApi().put('/api/user/payment-info', body)
}
