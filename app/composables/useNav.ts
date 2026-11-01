/**
 * Navigation — sidebar menu source.
 *
 * (v2.1.14) 单源迁至 shared/navigation.ts (前后端共用, #shared 别名):
 *   - 服务端 RBAC 把菜单表按用户权限过滤后经 useState('rbac_menus') 注水 (SSR);
 *   - 本 composable 优先消费服务端菜单 (名称/路径/图标/排序全部以菜单表为准),
 *     服务端菜单为空时 (种子失败/未升级) 回退静态 NAV_ITEMS;
 *   - is_admin 用户可见 admin 分组与 admin_only 菜单, 权限过滤已在服务端完成。
 * (v2.1.15) 分组动态化: 侧边栏分组 = menu_groups 表按 sort_order 排序输出,
 *   分组标题取表内 label (分组配置页可增删改), 不再写死 main/admin/bottom 三段。
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

/** 侧边栏分组段: 按分组排序输出, 每段含标题与该组菜单。 */
export interface NavGroupSection {
  key: string
  label: string
  items: NavItem[]
}

export function useNav() {
  const route = useRoute()
  const { user } = useAuth()
  const { groups, groupLabel } = useRbac()

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

  /**
   * 分组段列表: 以 menu_groups 表排序为准; 管理员可见全部段,
   * 普通用户滤掉仅管理员段 (段内全是 admin_only 菜单时整段不渲染)。
   */
  const sections = computed<NavGroupSection[]>(() => {
    const meta = groups.value.length
      ? groups.value
      : [
          { key: 'main', label: '主菜单', sort_order: 0 },
          { key: 'admin', label: '管理员', sort_order: 1 },
          { key: 'bottom', label: '其他', sort_order: 2 },
        ]
    const out: NavGroupSection[] = []
    for (const g of meta) {
      const gItems = items.value.filter((i) => (i.group || 'main') === g.key)
      if (!gItems.length) continue
      // 仅管理员段: 非管理员整段隐藏 (与 admin_only 菜单过滤同语义)
      if (g.key === 'admin' && !user.value?.is_admin) continue
      out.push({ key: g.key, label: g.label || groupLabel(g.key), items: gItems })
    }
    // 菜单落在已删除分组 (脏数据) 时兜底归入主菜单段, 绝不静默丢菜单
    const known = new Set(meta.map((g) => g.key))
    const orphans = items.value.filter((i) => !known.has(i.group || 'main'))
    if (orphans.length) {
      const main = out.find((s) => s.key === 'main')
      if (main) main.items.push(...orphans)
      else out.unshift({ key: 'main', label: groupLabel('main') || '主菜单', items: orphans })
    }
    return out
  })

  const mainItems = computed(() => items.value.filter((i) => i.group === 'main'))
  const adminItems = computed(() => items.value.filter((i) => i.group === 'admin'))
  const bottomItems = computed(() => items.value.filter((i) => i.group === 'bottom'))
  const isActive = (path: string) =>
    route.path === path || route.path.startsWith(path + '/')
  return { mainItems, adminItems, bottomItems, sections, isActive, all: items }
}
