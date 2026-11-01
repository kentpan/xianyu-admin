/**
 * Navigation config — single source of truth for the sidebar menu.
 *
 * (v2.1.14) 前后端共用模块 (Nuxt `shared/` 目录, #shared 别名双端可导入):
 *   - 前端 Sidebar / 面包屑 / 命令面板经 app/composables/useNav.ts 消费;
 *   - 后端 server/utils/rbac.ts 用它做 menus 表种子 + RBAC 权限判定;
 *   - 新增/调整菜单只改这里一处, 两端自动一致。
 */
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
  { path: '/listener', label: '监听服务', icon: 'server', group: 'main' },
  { path: '/items', label: '商品管理', icon: 'items', group: 'main' },
  { path: '/orders', label: '订单管理', icon: 'orders', group: 'main' },
  { path: '/messages', label: '消息管理', icon: 'message', group: 'main' },
  { path: '/manual-ship', label: '补发货', icon: 'ship', group: 'main' },
  { path: '/keywords', label: '自动回复', icon: 'keywords', group: 'main' },
  { path: '/item-replies', label: '指定商品回复', icon: 'itemReply', group: 'main' },
  { path: '/cards', label: '卡券管理', icon: 'cards', group: 'main' },
  { path: '/delivery', label: '自动发货', icon: 'delivery', group: 'main' },
  { path: '/reply-logs', label: '回复决策日志', icon: 'activity', group: 'main' },
  { path: '/filters', label: '消息过滤', icon: 'filter', group: 'main' },
  { path: '/notification-channels', label: '通知渠道', icon: 'channels', group: 'main' },
  { path: '/message-notifications', label: '消息通知', icon: 'msgNotify', group: 'main' },
  // 返佣分销系统
  { path: '/distribution/supply', label: '货源广场', icon: 'store', group: 'main' },
  { path: '/distribution/docked', label: '我的对接', icon: 'link', group: 'main' },
  { path: '/distribution/agent-orders', label: '代理订单', icon: 'handshake', group: 'main' },
  { path: '/distribution/fund-flows', label: '资金流水', icon: 'coins', group: 'main' },
  { path: '/settings', label: '系统设置', icon: 'settings', group: 'main' },

  { path: '/admin/ai-configs', label: 'AI配置', icon: 'sparkles', group: 'admin', adminOnly: true },
  { path: '/admin/api-keys', label: 'API Key管理', icon: 'key', group: 'admin', adminOnly: true },
  { path: '/admin/users', label: '用户管理', icon: 'users', group: 'admin', adminOnly: true },
  { path: '/admin/roles', label: '角色权限', icon: 'lock', group: 'admin', adminOnly: true },
  { path: '/admin/menus', label: '菜单管理', icon: 'menu', group: 'admin', adminOnly: true },
  { path: '/admin/logs', label: '系统日志', icon: 'logs', group: 'admin', adminOnly: true },
  { path: '/admin/risk-logs', label: '风控日志', icon: 'riskLogs', group: 'admin', adminOnly: true },
  { path: '/admin/audit', label: '操作审计', icon: 'shield', group: 'admin', adminOnly: true },
  { path: '/admin/settlement-records', label: '提现审核', icon: 'wallet', group: 'admin', adminOnly: true },
  { path: '/admin/data', label: '数据管理', icon: 'data', group: 'admin', adminOnly: true },

  { path: '/disclaimer', label: '免责声明', icon: 'disclaimer', group: 'bottom' },
  { path: '/wallet', label: '我的钱包', icon: 'wallet', group: 'bottom' },
  { path: '/profile', label: '个人中心', icon: 'user', group: 'bottom' },
  { path: '/about', label: '关于', icon: 'about', group: 'bottom' },
]
