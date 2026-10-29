import { useApi } from '~/composables/useApi'

export interface Wallet {
  balance: string
  fund_flow_count: number
  pending_withdraw_count: number
}

export interface SettlementRecord {
  id: number
  user_id: number
  payment_type: string
  payment_qrcode: string | null
  alipay_id: string | null
  amount: string
  status: string
  remark: string | null
  reject_reason: string | null
  created_at: string
  updated_at: string | null
  username?: string | null
  email?: string | null
}

export interface SettlementQuery {
  page?: number
  page_size?: number
  status?: string
  search?: string
}

export interface SettlementListResponse {
  items: SettlementRecord[]
  total: number
}

export interface WithdrawResult {
  id: number
  amount: string
  status: string
  balance: string
}

export function getWallet() {
  return useApi().get<Wallet>('/api/payment/wallet')
}

export function getPaymentSettlementRecords(query: SettlementQuery = {}) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.status) params.set('status', query.status)
  if (query.search) params.set('search', query.search)
  return useApi().get<SettlementListResponse>(`/api/payment/settlement-records?${params.toString()}`)
}

export function requestWithdraw(amount: string | number) {
  return useApi().post<WithdrawResult>('/api/payment/withdraw', { amount })
}
