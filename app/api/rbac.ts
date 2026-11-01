/**
 * RBAC API — 菜单管理 / 角色权限 / 用户角色分配 (v2.1.14)。
 * 管理端 CRUD 走 /api/admin/*, 当前用户可见菜单走 /api/auth/menus。
 */
import { useApi } from '~/composables/useApi'

export interface AdminMenu {
  id: number
  parent_id: number
  name: string
  path: string
  icon: string
  group_name: 'main' | 'admin' | 'bottom'
  sort_order: number
  admin_only: number
  enabled: number
  created_at?: string
  updated_at?: string
}

export interface AdminRole {
  id: number
  name: string
  description: string
  is_system: number
  user_count: number
  menu_count: number
  menu_ids: number[]
  created_at?: string
  updated_at?: string
}

export interface RoleAssignment {
  user_id: number
  role_id: number
  username: string
}

export function getAdminMenus() {
  return useApi().get<{ items: AdminMenu[]; tree: any[] }>('/api/admin/menus')
}

export function createMenu(payload: Partial<AdminMenu>) {
  return useApi().post<{ id: number }>('/api/admin/menus', payload)
}

export function updateMenu(id: number, payload: Partial<AdminMenu>) {
  return useApi().put<{ id: number }>(`/api/admin/menus/${id}`, payload)
}

export function deleteMenu(id: number) {
  return useApi().del(`/api/admin/menus/${id}`)
}

export function getAdminRoles() {
  return useApi().get<{ items: AdminRole[] }>('/api/admin/roles')
}

export function createRole(payload: { name: string; description?: string; menu_ids?: number[] }) {
  return useApi().post<{ id: number }>('/api/admin/roles', payload)
}

export function updateRole(id: number, payload: { name?: string; description?: string; menu_ids?: number[] }) {
  return useApi().put<{ id: number }>(`/api/admin/roles/${id}`, payload)
}

export function deleteRole(id: number) {
  return useApi().del(`/api/admin/roles/${id}`)
}

export function getRoleAssignments() {
  return useApi().get<{ assignments: RoleAssignment[] }>('/api/admin/roles/assignments')
}

export function updateUserRoles(userId: number, role_ids: number[]) {
  return useApi().put<{ id: number }>(`/api/admin/users/${userId}/roles`, { role_ids })
}

/** 当前登录用户可见菜单 (SSR 中间件为主通道, 此函数供客户端刷新)。 */
export function getMyMenus() {
  return useApi().get<{ menus: any[] }>('/api/auth/menus')
}
