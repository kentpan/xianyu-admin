/**
 * useRbac — 服务端菜单注水与权限状态 (v2.1.14, SSR 友好)。
 *
 * auth.global.ts 在服务端导航时调用 fetchMenus(): useApi 透传浏览器 Cookie,
 * /api/auth/menus 在服务端完成 JWT 校验与角色权限过滤, 结果经 useState payload
 * 水合到客户端 — 侧边栏首屏即按权限渲染, 客户端导航复用同一状态。
 * (v2.1.15) 分组标签 (menu_groups 表) 随菜单一并注水, 侧边栏分组标题不再写死。
 */
import { getMyMenus, type AdminMenu, type MenuGroup } from '~/api/rbac'

/** 内置分组兜底 (分组表为空/注水失败时侧边栏仍有分组标题)。 */
const FALLBACK_GROUPS: MenuGroup[] = [
  { id: -1, key: 'main', label: '主菜单', is_system: 1, sort_order: 0 },
  { id: -2, key: 'admin', label: '管理员', is_system: 1, sort_order: 1 },
  { id: -3, key: 'bottom', label: '其他', is_system: 1, sort_order: 2 },
]

export function useRbac() {
  const menus = useState<AdminMenu[]>('rbac_menus', () => [])
  const groups = useState<MenuGroup[]>('rbac_groups', () => [])
  const ready = useState<boolean>('rbac_ready', () => false)

  const menuPaths = computed(() => menus.value.map((m) => m.path))

  /** 路径是否在可见菜单内 (精确或子路径)。 */
  function pathAllowed(path: string): boolean {
    return menuPaths.value.some((p) => path === p || path.startsWith(p + '/'))
  }

  /** 分组标签查找 (key → label), 兜底内置/原文。 */
  function groupLabel(key: string): string {
    const all = groups.value.length ? groups.value : FALLBACK_GROUPS
    return all.find((g) => g.key === key)?.label || key
  }

  async function fetchMenus(): Promise<void> {
    try {
      const data = await getMyMenus()
      menus.value = (data?.menus as AdminMenu[]) || []
      const g = (data?.groups as MenuGroup[]) || []
      groups.value = g.length ? g : FALLBACK_GROUPS
    } catch {
      menus.value = []
      groups.value = FALLBACK_GROUPS
    } finally {
      ready.value = true
    }
  }

  function clearMenus(): void {
    menus.value = []
    groups.value = []
    ready.value = false
  }

  return { menus, groups, groupLabel, ready, menuPaths, pathAllowed, fetchMenus, clearMenus }
}
