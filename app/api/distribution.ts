import { useApi } from '~/composables/useApi'

// ===================== Supply =====================

export interface SupplyCard {
  id: number
  name: string
  type: string
  description: string | null
  price: string | null
  min_price: string | null
  dock_visibility: string | null
  fee_payer: string | null
  is_multi_spec: number
  spec_name: string | null
  spec_value: string | null
  owner_user_id: number
  owner_username: string | null
  created_at: string
  updated_at: string | null
}

export interface SupplyQuery {
  page?: number
  page_size?: number
  search?: string
  type?: string
}

export interface SupplyPage {
  items: SupplyCard[]
  total: number
  page: number
  page_size: number
  my_dock_code?: string
}

export function getDistributionSupply(query: SupplyQuery = {}) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.search) params.set('search', query.search)
  if (query.type) params.set('type', query.type)
  return useApi().get<SupplyPage>(`/api/distribution/supply?${params.toString()}`)
}

// ===================== Sub-Supply =====================

export interface SubSupplyItem {
  id: number
  dock_name: string
  sub_dock_price: string | null
  sub_dock_visibility: string | null
  delivery_count: number
  created_at: string
  card_id: number
  card_name: string | null
  card_type: string | null
  card_price: string | null
  fee_payer: string | null
  level1_user_id: number
  level1_username: string | null
}

export interface SubSupplyQuery {
  page?: number
  page_size?: number
  search?: string
}

export interface SubSupplyPage {
  items: SubSupplyItem[]
  total: number
  page: number
  page_size: number
}

export function getSubSupply(query: SubSupplyQuery = {}) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.search) params.set('search', query.search)
  return useApi().get<SubSupplyPage>(`/api/distribution/sub-supply?${params.toString()}`)
}

// ===================== Dock Records =====================

export interface DockRecord {
  id: number
  user_id: number
  card_id: number
  dock_name: string
  markup_amount: string | null
  remark: string | null
  delivery_count: number
  status: number
  disable_reason: string | null
  level: number
  parent_dock_id: number | null
  source_user_id: number | null
  allow_sub_dock: number
  sub_dock_price: string | null
  sub_dock_visibility: string | null
  created_at: string
  updated_at: string | null
  card_name: string | null
  card_type: string | null
  card_price: string | null
  fee_payer: string | null
  is_dockable: number | null
  card_enabled: number | null
  card_owner_user_id: number | null
  card_owner_username: string | null
}

export interface DockRecordQuery {
  page?: number
  page_size?: number
  search?: string
  level?: string
  status?: string
}

export interface DockRecordListResponse {
  items: DockRecord[]
  total: number
  page: number
  page_size: number
}

export interface CreateDockPayload {
  card_id: number
  dock_name: string
  markup_amount?: string
  remark?: string
}

export interface CreateSubDockPayload {
  parent_dock_id: number
  dock_name: string
  markup_amount?: string
  remark?: string
}

export interface UpdateDockPayload {
  dock_name?: string
  markup_amount?: string
  remark?: string | null
  status?: number
}

export interface ToggleSubDockPayload {
  allow: boolean
  sub_dock_price?: string
  sub_dock_visibility?: string
}

export interface PickupUrlResponse {
  url: string
  secret_key: string
  dock_id: number
}

export function getDockRecords(query: DockRecordQuery = {}) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.search) params.set('search', query.search)
  if (query.level) params.set('level', query.level)
  if (query.status !== undefined && query.status !== '') params.set('status', query.status)
  return useApi().get<DockRecordListResponse>(`/api/distribution/dock-records?${params.toString()}`)
}

export function createDockRecord(body: CreateDockPayload) {
  return useApi().post<{ id: number }>('/api/distribution/dock-records', body)
}

export function createSubDockRecord(body: CreateSubDockPayload) {
  return useApi().post<{ id: number }>('/api/distribution/sub-dock-records', body)
}

export function updateDockRecord(id: number, body: UpdateDockPayload) {
  return useApi().put(`/api/distribution/dock-records/${id}`, body)
}

export function toggleDockRecordStatus(id: number, status: boolean) {
  return useApi().put(`/api/distribution/dock-records/${id}`, { status: status ? 1 : 0 })
}

export function deleteDockRecord(id: number) {
  return useApi().del(`/api/distribution/dock-records/${id}`)
}

export function toggleSubDock(id: number, body: ToggleSubDockPayload) {
  return useApi().put(`/api/distribution/dock-records/${id}/toggle-sub-dock`, body)
}

export function getPickupUrl(id: number) {
  return useApi().get<PickupUrlResponse>(`/api/distribution/dock-records/${id}/pickup-url`)
}

// ===================== Agent Orders =====================

export interface AgentOrder {
  id: number
  order_no: string
  item_id: string | null
  card_id: number
  dock_record_id: number | null
  dock_level: number
  sale_price: string | null
  dock_price: string | null
  card_price: string | null
  level2_cost: string | null
  profit: string | null
  fee_amount: string | null
  fee_payer: string | null
  upstream_user_id: number | null
  upstream_dock_record_id: number | null
  owner_user_id: number | null
  buyer_id: string | null
  status: string
  settle_remark: string | null
  created_at: string
  updated_at: string | null
  card_name: string | null
  owner_username?: string | null
  upstream_username?: string | null
  dealer_username?: string | null
  dealer_user_id?: number | null
}

export interface AgentOrderQuery {
  page?: number
  page_size?: number
  search?: string
  status?: string
}

export interface AgentOrderPage {
  items: AgentOrder[]
  total: number
  page: number
  page_size: number
}

export function getMyAgentOrders(query: AgentOrderQuery = {}) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return useApi().get<AgentOrderPage>(`/api/distribution/agent-orders/my?${params.toString()}`)
}

export function getUpstreamAgentOrders(query: AgentOrderQuery = {}) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return useApi().get<AgentOrderPage>(`/api/distribution/agent-orders/upstream?${params.toString()}`)
}

export function getAgentOrderDetail(id: number) {
  return useApi().get<AgentOrder>(`/api/distribution/agent-orders/${id}`)
}

// ===================== Fund Flows =====================

export interface FundFlow {
  id: number
  user_id: number
  type: string
  amount: string
  balance_before: string
  balance_after: string
  description: string | null
  order_id: string | null
  dock_record_id: number | null
  created_at: string
  username?: string | null
}

export interface FundFlowQuery {
  page?: number
  page_size?: number
  type?: string
  search?: string
}

export interface FundFlowListResponse {
  items: FundFlow[]
  total: number
  page: number
  page_size: number
}

export function getFundFlows(query: FundFlowQuery = {}) {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size))
  if (query.type) params.set('type', query.type)
  if (query.search) params.set('search', query.search)
  return useApi().get<FundFlowListResponse>(`/api/distribution/fund-flows?${params.toString()}`)
}
