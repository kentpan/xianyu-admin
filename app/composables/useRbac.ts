/**
 * useRbac — 服务端菜单注水与权限状态 (v2.1.14, SSR 友好)。
 *
 * auth.global.ts 在服务端导航时调用 fetchMenus(): useApi 透传浏览器 Cookie,
 * /api/auth/menus 在服务端完成 JWT 校验与角色权限过滤, 结果经 useState payload
 * 水合到客户端 — 侧边栏首屏即按权限渲染, 客户端导航复用同一状态。
 */
import { getMyMenus, type AdminMenu } from '~/api/rbac'

export function useRbac() {
  const menus = useState<AdminMenu[]>('rbac_menus', () => [])
  const ready = useState<boolean>('rbac_ready', () => false)

  const menuPaths = computed(() => menus.value.map((m) => m.path))

  /** 路径是否在可见菜单内 (精确或子路径)。 */
  function pathAllowed(path: string): boolean {
    return menuPaths.value.some((p) => path === p || path.startsWith(p + '/'))
  }

  async function fetchMenus(): Promise<void> {
    try {
      const data = await getMyMenus()
      menus.value = (data?.menus as AdminMenu[]) || []
    } catch {
      menus.value = []
    } finally {
      ready.value = true
    }
  }

  function clearMenus(): void {
    menus.value = []
    ready.value = false
  }

  return { menus, ready, menuPaths, pathAllowed, fetchMenus, clearMenus }
}
