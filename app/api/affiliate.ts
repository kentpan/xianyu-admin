import { useApi } from '~/composables/useApi'

export interface NetworkField {
  key: string
  label: string
  type: 'text' | 'password' | 'textarea'
  required: boolean
  placeholder?: string
  help?: string
  role?: 'auth' | 'tracking' | 'endpoint'
}
export interface RegistrationStep {
  title: string
  detail: string
}
export interface AffiliateNetwork {
  id: string
  name: string
  nameCn?: string
  region: 'domestic' | 'overseas'
  color: string
  registerUrl: string
  docsUrl?: string
  description: string
  commissionModel: string
  registrationSteps: RegistrationStep[]
  fields: NetworkField[]
  supportsServerSearch: boolean
  searchEndpoint?: string
  signType?: 'md5' | 'hmac' | 'none'
  enabled: boolean
}

export interface AffiliateAccount {
  id: number
  user_id: number
  network_id: string
  display_name: string
  credentials: Record<string, string>
  enabled: number
  remark: string | null
  last_sync_at: string | null
  created_at: string
  updated_at: string
  network_name: string
  network_meta: AffiliateNetwork | null
}

export interface AffiliateProduct {
  id: number
  user_id: number
  account_id: number
  network_id: string
  item_id: string
  title: string | null
  price: string | null
  commission_rate: string | null
  commission_amount: string | null
  pic_url: string | null
  item_url: string | null
  shop_name: string | null
  category: string | null
  sales: string | null
  coupon: string | null
  collected: number
  created_at: string
  updated_at: string
}

export interface SearchResultItem {
  item_id: string
  title: string
  price: string
  commission_rate: string
  commission_amount: string
  pic_url: string
  item_url: string
  shop_name: string
  category: string
  sales: string
  coupon?: { amount: string; start_fee?: string; url?: string }
  raw?: any
}

export function getNetworks() {
  return useApi().get<{ domestic: AffiliateNetwork[]; overseas: AffiliateNetwork[] }>('/api/affiliate/networks')
}
export function getNetworkDetail(id: string) {
  return useApi().get<AffiliateNetwork>(`/api/affiliate/networks/${encodeURIComponent(id)}`)
}
export function getAccounts() {
  return useApi().get<AffiliateAccount[]>('/api/affiliate/accounts')
}
export function saveAccount(body: { network_id: string; display_name?: string; credentials: Record<string, string>; remark?: string }) {
  return useApi().post<{ id: number }>('/api/affiliate/accounts', body)
}
export function updateAccount(id: number, body: { enabled?: boolean; remark?: string }) {
  return useApi().put(`/api/affiliate/accounts/${id}`, body)
}
export function deleteAccount(id: number) {
  return useApi().del(`/api/affiliate/accounts/${id}`)
}
export function searchProducts(params: {
  account_id: number
  keyword: string
  page?: number
  page_size?: number
  sort?: string
  min_price?: number
  max_price?: number
  has_coupon?: boolean
}) {
  const q = new URLSearchParams()
  q.set('account_id', String(params.account_id))
  q.set('keyword', params.keyword)
  if (params.page) q.set('page', String(params.page))
  if (params.page_size) q.set('page_size', String(params.page_size))
  if (params.sort) q.set('sort', params.sort)
  if (params.min_price) q.set('min_price', String(params.min_price))
  if (params.max_price) q.set('max_price', String(params.max_price))
  if (params.has_coupon) q.set('has_coupon', 'true')
  return useApi().get<{ items: SearchResultItem[]; total: number; message?: string; externalUrl?: string; network?: AffiliateNetwork }>(`/api/affiliate/products/search?${q.toString()}`)
}
export function getProducts(params: { account_id?: number; keyword?: string; collected?: boolean; page?: number; page_size?: number }) {
  const q = new URLSearchParams()
  if (params.account_id) q.set('account_id', String(params.account_id))
  if (params.keyword) q.set('keyword', params.keyword)
  if (params.collected) q.set('collected', '1')
  if (params.page) q.set('page', String(params.page))
  if (params.page_size) q.set('page_size', String(params.page_size))
  return useApi().get<{ items: AffiliateProduct[]; total: number; page: number; page_size: number }>(`/api/affiliate/products?${q.toString()}`)
}
export function toggleCollect(id: number, collected: boolean) {
  return useApi().post(`/api/affiliate/products/${id}/collect`, { collected })
}
export function productToCard(id: number, body: { item_id?: string; keyword?: string; cookie_id?: string }) {
  return useApi().post<{ card_id: number; message: string }>(`/api/affiliate/products/${id}/to-card`, body)
}
