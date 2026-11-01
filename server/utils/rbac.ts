/**
 * RBAC — 菜单级角色权限 (v2.1.14)。
 *
 * 模型: users —(user_roles)— roles —(role_menus)— menus
 *   - menus: 树状菜单表, 种子来自 shared/navigation.ts NAV_ITEMS (单源, 幂等补种);
 *   - is_admin = 1 的用户为超级用户, 绕过角色直接拥有全部菜单 (与 /admin/* 路由守卫同语义);
 *   - 普通用户的可见菜单 = 其全部角色经 role_menus 并集, 且不含 admin_only 菜单;
 *   - 内置角色: 超级管理员 (自动跟随全量菜单, 不可删) / 普通用户 (首次种子灌
 *     main+bottom 全量菜单, 之后可自定义)。
 *
 * 消费方:
 *   - server/api/auth/menus.get.ts — SSR 中间件按登录态拉取可见菜单;
 *   - app/middleware/auth.global.ts — 服务端路由守卫按菜单路径做权限拦截;
 *   - /api/admin/menus, /api/admin/roles — 菜单管理与角色管理 CRUD。
 */
import type { DatabaseAdapter } from './db'
import { NAV_ITEMS } from '#shared/navigation'

export interface MenuRow {
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

/** 内置菜单分组 (不可删, 标签可改): 侧边栏分组标题单源。 */
export const BUILTIN_MENU_GROUPS: Array<{ key: string; label: string; sort: number }> = [
  { key: 'main', label: '主菜单', sort: 0 },
  { key: 'admin', label: '管理员', sort: 1 },
  { key: 'bottom', label: '其他', sort: 2 },
]

/** 幂等补种: 菜单种子 (按 path 去重, NAV_ITEMS 新增菜单自动入表) + 内置角色 + 存量用户兜底。 */
export async function seedRbac(db: DatabaseAdapter): Promise<void> {
  // 0) 菜单分组种子 (INSERT OR IGNORE 幂等): 内置 main/admin/bottom, 菜单管理分组配置页可新增自定义组
  for (const g of BUILTIN_MENU_GROUPS) {
    await db
      .run('INSERT OR IGNORE INTO menu_groups (key, label, is_system, sort_order) VALUES (?, ?, 1, ?)', [g.key, g.label, g.sort])
      .catch(() => {})
  }

  // 1) 菜单种子: 已存在 (按 path) 的跳过, 名称/图标/排序不覆盖 (菜单管理页可自定义)
  const existing = new Set(
    (await db.all<{ path: string }>('SELECT path FROM menus').catch(() => [])).map((r) => r.path),
  )
  for (let i = 0; i < NAV_ITEMS.length; i++) {
    const item = NAV_ITEMS[i]
    if (existing.has(item.path)) continue
    await db
      .run(
        `INSERT INTO menus (parent_id, name, path, icon, group_name, sort_order, admin_only, enabled)
         VALUES (0, ?, ?, ?, ?, ?, ?, 1)`,
        [item.label, item.path, item.icon, item.group, i, item.adminOnly ? 1 : 0],
      )
      .catch(() => {})
  }

  // 2) 内置角色 (INSERT OR IGNORE 幂等)
  await db
    .run(`INSERT OR IGNORE INTO roles (name, description, is_system) VALUES ('超级管理员', '内置角色: 自动拥有全部菜单, 不可删除', 1)`)
    .catch(() => {})
  await db
    .run(`INSERT OR IGNORE INTO roles (name, description, is_system) VALUES ('普通用户', '内置角色: 默认拥有全部主菜单与底部菜单, 可自定义', 1)`)
    .catch(() => {})
  const adminRole = await db.get<{ id: number }>(`SELECT id FROM roles WHERE name = '超级管理员'`).catch(() => null)
  const userRole = await db.get<{ id: number }>(`SELECT id FROM roles WHERE name = '普通用户'`).catch(() => null)
  if (!adminRole || !userRole) return

  const menus = await db
    .all<{ id: number; admin_only: number; enabled: number }>('SELECT id, admin_only, enabled FROM menus')
    .catch(() => [])

  // 3) 超级管理员: 全量菜单幂等跟随 (管理页对其改权限无意义, 永远全量)
  for (const m of menus) {
    await db.run('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)', [adminRole.id, m.id]).catch(() => {})
  }

  // 4) 普通用户: 仅首次种子 (零菜单时) 灌 main+bottom 全量, 之后角色权限可在管理页自定义
  const cnt = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM role_menus WHERE role_id = ?', [userRole.id]).catch(() => null)
  if (!cnt?.c) {
    for (const m of menus) {
      if (Number(m.admin_only) === 1 || Number(m.enabled) !== 1) continue
      await db.run('INSERT OR IGNORE INTO role_menus (role_id, menu_id) VALUES (?, ?)', [userRole.id, m.id]).catch(() => {})
    }
  }

  // 5) 存量用户兜底: 一个角色都没有的用户 → 挂普通用户 (升级无感, 不会被权限锁死)
  await db
    .run(
      `INSERT OR IGNORE INTO user_roles (user_id, role_id)
       SELECT u.id, ? FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)`,
      [userRole.id],
    )
    .catch(() => {})
}

/** 按用户取可见菜单 (已排序): admin 全量 enabled; 普通用户走角色并集且排除 admin_only。 */
export async function getMenusForUser(db: DatabaseAdapter, userId: number, isAdmin: boolean): Promise<MenuRow[]> {
  const cols = 'id, parent_id, name, path, icon, group_name, sort_order, admin_only, enabled'
  if (isAdmin) {
    return (
      (await db
        .all<MenuRow>(`SELECT ${cols} FROM menus WHERE enabled = 1 ORDER BY sort_order, id`)
        .catch(() => [])) || []
    )
  }
  return (
    (await db
      .all<MenuRow>(
        `SELECT ${cols} FROM menus m
         WHERE m.enabled = 1 AND m.admin_only = 0
           AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_menus rm ON rm.role_id = ur.role_id
                       WHERE ur.user_id = ? AND rm.menu_id = m.id)
         ORDER BY m.sort_order, m.id`,
        [userId],
      )
      .catch(() => [])) || []
  )
}

/** 路由权限判定: path 命中任一可见菜单的精确路径或其子路径。 */
export async function userHasMenuPath(db: DatabaseAdapter, userId: number, isAdmin: boolean, path: string): Promise<boolean> {
  const menus = await getMenusForUser(db, userId, isAdmin)
  return menus.some((m) => path === m.path || path.startsWith(m.path + '/'))
}

/** 菜单分组行 (侧边栏标题/菜单管理分组配置共用)。 */
export interface MenuGroupRow {
  id: number
  key: string
  label: string
  is_system: number
  sort_order: number
}

/** 按排序取全部分组 (侧边栏 SSR 标题 + 菜单/角色管理页共用)。 */
export async function getMenuGroups(db: DatabaseAdapter): Promise<MenuGroupRow[]> {
  return (
    (await db
      .all<MenuGroupRow>('SELECT id, key, label, is_system, sort_order FROM menu_groups ORDER BY sort_order, id')
      .catch(() => [])) || []
  )
}

/** 平铺菜单行 → 树 (菜单管理页用)。 */
export function buildMenuTree(rows: MenuRow[]): Array<MenuRow & { children: MenuRow[] }> {
  const roots: Array<MenuRow & { children: MenuRow[] }> = []
  const byId = new Map<number, MenuRow & { children: MenuRow[] }>()
  for (const r of rows) byId.set(r.id, { ...r, children: [] })
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
