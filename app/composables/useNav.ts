/**
 * Navigation — sidebar menu source.
 *
 * (v2.1.14) 单源迁至 shared/navigation.ts (前后端共用, #shared 别名):
 *   - 服务端 RBAC 把菜单表按用户权限过滤后经 useState('rbac_menus') 注水 (SSR);
 *   - 本 composable 优先消费服务端菜单 (名称/路径/图标/排序全部以菜单表为准),
 *     服务端菜单为空时 (种子失败/未升级) 回退静态 NAV_ITEMS;
 *   - is_admin 用户可见 admin 分组与 admin_only 菜单, 权限过滤已在服务端完成。
 */
import type { Component } from 'vue'
import { NAV_ITEMS, type NavItem } from '#shared/navigation'

export { NAV_ITEMS }
export type { NavItem }

/** 服务端下发的菜单行 (GET /api/auth/menus 返回结构)。 */
export interface ServerMenuRow {
  id: number
  parent_id: number
  name: string
  path: string
  icon: string
  group_name: string
  sort_order: number
  admin_only: number
  enabled: number
}

export function useNav() {
  const route = useRoute()
  const { user } = useAuth()

  // 服务端注水的菜单 (SSR 中间件已按登录态+权限拉取, payload 水合到客户端)
  const serverMenus = useState<ServerMenuRow[]>('rbac_menus', () => [])

  const items = computed<NavItem[]>(() => {
    const rows = serverMenus.value
    if (rows.length) {
      return rows.map((m) => ({
        path: m.path,
        label: m.name,
        icon: m.icon || 'dashboard',
        group: (m.group_name as NavItem['group']) || 'main',
        adminOnly: Number(m.admin_only) === 1,
      }))
    }
    // 回退: 静态配置 (非管理员滤掉 admin 分组)
    return NAV_ITEMS.filter((i) => !i.adminOnly || user.value?.is_admin)
  })

  const mainItems = computed(() => items.value.filter((i) => i.group === 'main'))
  const adminItems = computed(() => items.value.filter((i) => i.group === 'admin'))
  const bottomItems = computed(() => items.value.filter((i) => i.group === 'bottom'))
  const isActive = (path: string) =>
    route.path === path || route.path.startsWith(path + '/')
  return { mainItems, adminItems, bottomItems, isActive, all: items }
}
