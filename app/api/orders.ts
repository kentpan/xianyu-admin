import { useApi } from '~/composables/useApi'

export interface Order {
  order_id: string
  item_id: string | null
  buyer_id: string | null
  spec_name: string | null
  spec_value: string | null
  quantity: string | null
  amount: string | null
  order_status: string
  cookie_id: string | null
  chat_id?: string
  is_bargain?: number
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  receiver_city: string
  created_at: string
  updated_at: string
  item_title?: string | null
  cookie_remark?: string | null
}

export interface OrderListResponse {
  data: Order[]
  total: number
  page: number
  pageSize: number
}

export interface OrderQuery {
  page?: number
  pageSize?: number
  status?: string
  cookie_id?: string
  keyword?: string
  dateFrom?: string
  dateTo?: string
  amountMin?: string
  amountMax?: string
}

export interface BatchOrdersResult {
  affected?: number
  count?: number
  orders?: Order[]
}

export interface ImportOrdersResult {
  inserted: number
  updated: number
}

export interface ExportOrdersResult {
  orders: Order[]
  count: number
}

export function getOrders(query: OrderQuery = {}) {
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = String(v)
        return acc
      }, {}),
  ).toString()
  return useApi().get<OrderListResponse>(`/api/orders?${qs}`)
}

export function getOrder(orderId: string) {
  return useApi().get<Order>(`/api/orders/${encodeURIComponent(orderId)}`)
}

export function updateOrder(orderId: string, body: Partial<Order>) {
  return useApi().put(`/api/orders/${encodeURIComponent(orderId)}`, body)
}

export function deleteOrder(orderId: string) {
  return useApi().del(`/api/orders/${encodeURIComponent(orderId)}`)
}

export function batchOrders(ids: string[], action: string) {
  return useApi().post<BatchOrdersResult>('/api/orders/batch', { ids, action })
}

export function refreshOrder(orderId: string) {
  return useApi().post(`/api/orders/${encodeURIComponent(orderId)}/refresh`)
}

export interface RefreshAllResult {
  total: number
  updated: number
  no_change: number
  failed: number
  results: { order_id: string; changed: boolean; error?: string }[]
}

/** 批量刷新非终态订单状态 (实查闲鱼订单详情, 限速防风控) */
export function refreshAllOrders(body: { cookie_id?: string; status?: string } = {}) {
  return useApi().post<RefreshAllResult>('/api/orders/refresh', body)
}

export function manualShip(body: { order_id: string; mode: string }) {
  return useApi().post('/api/orders/manual-ship', body)
}

export function importOrders(orders: any[]) {
  return useApi().post<ImportOrdersResult>('/api/orders/import', { orders })
}

export function exportOrders() {
  return useApi().get<ExportOrdersResult>('/api/orders/export')
}
