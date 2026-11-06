import { useApi } from '~/composables/useApi'

export interface DashboardStats {
  totalAccounts: number
  activeAccounts: number
  totalKeywords: number
  totalOrders: number
  totalItems: number
  totalCards: number
  totalChannels: number
  orderStatusDist: Record<string, number>
  recentOrders: any[]
  recentLogs: any[]
}

export interface TrendDay {
  date: string
  label: string
  count: number
  revenue: number
}

export interface TrendResponse {
  days: TrendDay[]
  totalOrders: number
  totalRevenue: number
}

export interface ActivityItem {
  id: string
  type: string
  icon: string
  color: string
  title: string
  desc: string
  time: string
  ts: number
}

export interface ActivityResponse {
  activities: ActivityItem[]
}

export interface OnlineAccount {
  id: string
  remark: string
  enabled: boolean
  autoConfirm: boolean
  keywordCount: number
  orderCount: number
  lastOrderAt: string | null
  ageHours: number
  isOnline: boolean
}

export interface OnlineStatusResponse {
  items: OnlineAccount[]
  summary: {
    total: number
    online: number
    offline: number
    disabled: number
  }
}

export function getDashboardStats() {
  return useApi().get<DashboardStats>('/api/dashboard/stats')
}

export function getDashboardTrend() {
  return useApi().get<TrendResponse>('/api/dashboard/trend')
}

export function getDashboardHealth() {
  return useApi().get<any>('/api/dashboard/health')
}

export function getDashboardOnline() {
  return useApi().get<OnlineStatusResponse>('/api/dashboard/online')
}

export function getDashboardComparison() {
  return useApi().get<any>('/api/dashboard/comparison')
}

export function getDashboardActivity() {
  return useApi().get<ActivityResponse>('/api/dashboard/activity')
}

/** D1 读写配额核心指标 (v2.3.5) */
export interface D1UsageSnapshot {
  driver: string
  source: 'exact' | 'estimate'
  day: string
  rowsRead: number
  rowsWritten: number
  readQueries: number
  writeQueries: number
  limits: { read: number; write: number }
  readPct: number
  writePct: number
  readStatus: 'ok' | 'warn' | 'danger' | 'exceeded'
  writeStatus: 'ok' | 'warn' | 'danger' | 'exceeded'
  resetAt: string
  resetInSeconds: number
  history: { day: string; rowsRead: number; rowsWritten: number }[]
}

export function getDashboardD1Metrics() {
  return useApi().get<D1UsageSnapshot>('/api/dashboard/d1-metrics')
}

/**
 * Returns the full URL for the dashboard PDF report (used by window.open).
 * Resolves against runtimeConfig.public.basePath so it works under sub-path deployments.
 */
export function getDashboardReportUrl(): string {
  const basePath = useRuntimeConfig().public.basePath || ''
  return `${basePath}/api/dashboard/report`
}
