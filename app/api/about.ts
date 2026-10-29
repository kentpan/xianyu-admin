import { useApi } from '~/composables/useApi'

export interface ProjectMetrics {
  users: number
  accounts: number
  orders: number
  items: number
  keywords: number
  cards: number
  deliveryRules: number
  channels: number
  settings: number
  logs: number
  tableCount: number
  driver: string
  appName: string
  appVersion: string
  uptime: number
}

export function getAboutStats() {
  return useApi().get<ProjectMetrics>('/api/about/stats')
}
