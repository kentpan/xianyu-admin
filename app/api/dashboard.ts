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

/**
 * Returns the full URL for the dashboard PDF report (used by window.open).
 * Resolves against runtimeConfig.public.basePath so it works under sub-path deployments.
 */
export function getDashboardReportUrl(): string {
  const basePath = useRuntimeConfig().public.basePath || ''
  return `${basePath}/api/dashboard/report`
}
