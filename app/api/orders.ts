import { useApi } from '~/composables/useApi'

export interface Order {
  order_id: string
  item_id: string | null
  item_title?: string | null
  buyer_id: string | null
  buyer_nick?: string | null
  seller_id?: string | null
  spec_name: string | null
  spec_value: string | null
  quantity: string | null
  amount: string | null
  /** 商品真实单价 (v2.2.6 全量同步解析, 响应未携带为空串/null)。 */
  item_price?: string | null
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
  paid_at?: string | null
  shipped_at?: string | null
  finished_at?: string | null
  cancelled_at?: string | null
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
  /** 归属筛选: mine=已添加账号 / other=非已添加账号(兼容口径) / full=v2.2.7 全量订单(闲鱼趋势tab) / 默认 all 不过滤 */
  scope?: 'mine' | 'other' | 'full' | 'all'
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

/** 单订单本地编辑 (精修: 状态/金额/收货信息) */
export function updateOrder(orderId: string, body: Partial<Order>) {
  return useApi().put(`/api/orders/${encodeURIComponent(orderId)}`, body)
}

/** 单订单详情精修: 从闲鱼实查该订单详情并回写本地库 */
export function refreshOrder(orderId: string) {
  return useApi().post(`/api/orders/${encodeURIComponent(orderId)}/refresh`)
}

export function deleteOrder(orderId: string) {
  return useApi().del(`/api/orders/${encodeURIComponent(orderId)}`)
}

export function batchOrders(ids: string[], action: string) {
  return useApi().post<BatchOrdersResult>('/api/orders/batch', { ids, action })
}

export interface RefreshAllResult {
  inserted: number
  updated: number
  blocked: number
  skipped_deleted: number
  accounts: number
  errors: string[]
  mode?: string
  elapsed_ms?: number
}

/** 获取最新的订单列表: 拉闲鱼卖家全部状态订单列表入库 (纯列表同步, 无逐单详情精修) */
export function refreshAllOrders(body: { cookie_id?: string } = {}) {
  return useApi().post<RefreshAllResult>('/api/orders/refresh', body)
}

/* ==================== 全量订单同步 (v2.2.6, 闲鱼趋势 tab) ==================== */

export interface SyncAllResult {
  inserted: number
  updated: number
  skipped_deleted: number
  accounts: number
  errors: string[]
  mode?: string
  elapsed_ms?: number
}

/**
 * 全量订单同步: 2.1.7 订单拉取链路独立移植 — 不判断区分账号拉取全部状态订单入库
 * (商品名称/买家昵称/卖家身份随单真实落库), 闲鱼趋势 tab「同步订单」按钮数据源。
 */
export function syncAllOrders(body: { pages?: number } = {}) {
  return useApi().post<SyncAllResult>('/api/orders/sync-all', body)
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

/* ==================== 闲鱼趋势 (v2.2.5) ==================== */

export interface TrendMetricDay extends Record<string, any> {
  date: string
  label: string
  count: number
  revenue: number
  paid: number
  received: number
  refunded: number
}

export interface OrderTrends {
  days: TrendMetricDay[]
  metrics: {
    totals: { all: number; paid: number; received: number; refunded: number }
    week: { all: number; paid: number; received: number; refunded: number; revenue: number }
  }
  other_total: number
}

/** 闲鱼趋势: 近7天全部账号订单趋势 + 已付款/已收货/已退款核心指标 (真实库内数据) */
export function getOrderTrends() {
  return useApi().get<OrderTrends>('/api/orders/trends')
}

/* ==================== 存量订单核验修复 (v2.3.0) ==================== */

export interface RepairOrdersResult {
  checked: number
  time_fixed: number
  seller_fixed: number
  nick_fixed: number
  removed: number
  skipped_risk: number
  errors: string[]
}

/**
 * 存量订单核验修复: 逐单调闲鱼订单详情接口对账 —
 * 回填真实下单时间 (修复旧版"同批订单时间全部同一秒"的时间堆积存量)、
 * 卖家身份/买家昵称, 清理订单号精度丢失的截断脏单 (详情必查不到, 零误伤)。
 */
export function repairOrders(body: { limit?: number } = {}) {
  return useApi().post<RepairOrdersResult>('/api/orders/repair', body)
}

/* ==================== 全平台热门商品趋势 (v2.3.0) ==================== */

export interface HotTrendItem {
  item_id: string
  title: string
  price: string
  seller_id: string
  seller_nick: string
  area: string
  pic_url: string
  want_count: number
  keyword: string
  /** 商品类型 (v2.3.0): virtual=虚拟商品 / physical=实体商品 (标题特征词分类) */
  item_type?: string
  seen_count: number
  first_seen_at: string
  last_seen_at: string
}

export interface HotTrendsResult {
  items: HotTrendItem[]
  stats: { total: number; sellers: number; min_price: number | null; max_price: number | null }
  keywords: { keyword: string; c: number }[]
}

/** 全平台热门商品榜单 (trend_hot_items 聚合快照) — item_type: virtual/physical/空=全部 */
export function getHotTrends(query: { keyword?: string; item_type?: string; limit?: number; sort?: string } = {}) {
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = String(v)
        return acc
      }, {}),
  ).toString()
  return useApi().get<HotTrendsResult>(`/api/orders/hot-trends?${qs}`)
}

export interface SyncHotTrendsResult {
  synced: number
  new_items: number
  updated_items: number
  pages: number
  errors: string[]
}

/** 全平台商品搜索同步: 关键词搜索闲鱼站内在售商品并聚合进热门榜 */
export function syncHotTrends(body: { keyword: string; pages?: number; cookie_id?: string }) {
  return useApi().post<SyncHotTrendsResult>('/api/orders/hot-trends/sync', body)
}
