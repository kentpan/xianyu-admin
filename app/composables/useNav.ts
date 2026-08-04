/**
 * Navigation config — single source of truth for the sidebar menu.
 * Pages render purely from this data; no hard-coded nav anywhere else.
 */
import type { Component } from 'vue'

export interface NavItem {
  path: string
  label: string
  icon: string // icon name from the icon map (lucide-like keys)
  group: 'main' | 'admin' | 'bottom'
  adminOnly?: boolean
  badge?: string
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: '工作台', icon: 'dashboard', group: 'main' },
  { path: '/accounts', label: '账号管理', icon: 'accounts', group: 'main' },
  { path: '/items', label: '商品管理', icon: 'items', group: 'main' },
  { path: '/orders', label: '订单管理', icon: 'orders', group: 'main' },
  { path: '/manual-ship', label: '补发货', icon: 'ship', group: 'main' },
  { path: '/keywords', label: '自动回复', icon: 'keywords', group: 'main' },
  { path: '/item-replies', label: '指定商品回复', icon: 'itemReply', group: 'main' },
  { path: '/cards', label: '卡券管理', icon: 'cards', group: 'main' },
  { path: '/delivery', label: '自动发货', icon: 'delivery', group: 'main' },
  { path: '/notification-channels', label: '通知渠道', icon: 'channels', group: 'main' },
  { path: '/message-notifications', label: '消息通知', icon: 'msgNotify', group: 'main' },
  { path: '/settings', label: '系统设置', icon: 'settings', group: 'main' },

  { path: '/admin/users', label: '用户管理', icon: 'users', group: 'admin', adminOnly: true },
  { path: '/admin/logs', label: '系统日志', icon: 'logs', group: 'admin', adminOnly: true },
  { path: '/admin/risk-logs', label: '风控日志', icon: 'riskLogs', group: 'admin', adminOnly: true },
  { path: '/admin/audit', label: '操作审计', icon: 'shield', group: 'admin', adminOnly: true },
  { path: '/admin/data', label: '数据管理', icon: 'data', group: 'admin', adminOnly: true },

  { path: '/disclaimer', label: '免责声明', icon: 'disclaimer', group: 'bottom' },
  { path: '/profile', label: '个人中心', icon: 'user', group: 'bottom' },
  { path: '/about', label: '关于', icon: 'about', group: 'bottom' },
]

export function useNav() {
  const route = useRoute()
  const mainItems = NAV_ITEMS.filter((i) => i.group === 'main')
  const adminItems = NAV_ITEMS.filter((i) => i.group === 'admin')
  const bottomItems = NAV_ITEMS.filter((i) => i.group === 'bottom')
  const isActive = (path: string) =>
    route.path === path || route.path.startsWith(path + '/')
  return { mainItems, adminItems, bottomItems, isActive, all: NAV_ITEMS }
}
