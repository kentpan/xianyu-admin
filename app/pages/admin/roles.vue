<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="角色权限" description="RBAC 角色管理与菜单级授权：角色勾选可见菜单，用户挂载角色；登录态与菜单列表均由服务端校验渲染">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增角色
        </button>
      </template>
    </PageHeader>

    <!-- Roles -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>角色</th>
                <th>描述</th>
                <th>菜单授权</th>
                <th>用户数</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in roles" :key="r.id">
                <td>
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-slate-800 dark:text-white">{{ r.name }}</span>
                    <span v-if="r.is_system" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">内置</span>
                  </div>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ r.description || '—' }}</td>
                <td class="text-slate-500 dark:text-slate-400">{{ r.menu_count }} 项</td>
                <td class="text-slate-500 dark:text-slate-400">{{ r.user_count }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="编辑角色与授权" @click="openEdit(r)">
                      <Icon name="edit" />
                    </button>
                    <button
                      class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      :title="r.is_system ? '内置角色不可删除' : '删除角色'"
                      :disabled="!!r.is_system"
                      @click="confirmDelete(r)"
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!roles.length" message="暂无角色" icon="lock" />
      </template>
    </div>

    <!-- User assignment -->
    <div class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <Icon name="users" class="text-brand-500" />
        <span class="font-medium text-slate-800 dark:text-white">用户角色分配</span>
      </div>
      <div class="table-wrap max-h-96 overflow-y-auto">
        <table class="table">
          <thead>
            <tr>
              <th>用户</th>
              <th>平台角色</th>
              <th>RBAC 角色</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>
                <span class="font-medium text-slate-800 dark:text-white">{{ u.username }}</span>
                <span v-if="u.is_admin" class="badge ml-2 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">管理员</span>
              </td>
              <td class="text-slate-500 dark:text-slate-400">{{ u.is_admin ? '超级用户 (拥有全部菜单)' : '按 RBAC 角色授权' }}</td>
              <td>
                <div class="flex flex-wrap gap-3">
                  <label v-for="r in roles" :key="r.id" class="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      class="w-4 h-4 accent-brand-500"
                      :checked="userRoleIds(u.id).includes(r.id)"
                      @change="toggleUserRole(u, r.id, ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="text-slate-600 dark:text-slate-300">{{ r.name }}</span>
                  </label>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-if="!users.length" message="暂无用户" icon="users" />
      </div>
    </div>

    <!-- Create / Edit role modal -->
    <ModalBase v-model="dialogOpen" :title="editingId ? '编辑角色' : '新增角色'" @close="dialogOpen = false">
      <div class="space-y-4 py-1">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">角色名称 <span class="text-red-500">*</span></label>
            <input v-model="roleForm.name" class="input w-full" placeholder="如：运营" />
          </div>
          <div>
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">描述</label>
            <input v-model="roleForm.description" class="input w-full" placeholder="角色职责说明" />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-slate-600 dark:text-slate-300">菜单授权 (勾选该角色可见的菜单)</label>
            <span v-if="superAdminSelected" class="text-amber-600 dark:text-amber-400">超级管理员自动拥有全部菜单, 无需配置</span>
          </div>
          <div class="max-h-80 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-4">
            <div v-for="g in menuGroups" :key="g.key">
              <p class="font-medium text-slate-700 dark:text-slate-200 mb-2">{{ g.label }}</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label
                  v-for="m in g.items"
                  :key="m.id"
                  class="flex items-center gap-2 cursor-pointer select-none rounded px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    class="w-4 h-4 accent-brand-500"
                    :disabled="superAdminSelected || !m.enabled"
                    :checked="roleForm.menu_ids.includes(m.id)"
                    @change="toggleMenu(m.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <Icon :name="m.icon || 'dashboard'" class="text-brand-500" />
                  <span class="text-slate-600 dark:text-slate-300">{{ m.name }}</span>
                  <span class="text-slate-400">{{ m.path }}</span>
                  <span v-if="!m.enabled" class="badge bg-slate-100 text-slate-400 dark:bg-slate-800">已停用</span>
                </label>
              </div>
            </div>
            <p v-if="!menus.length" class="text-slate-400">菜单表为空 — 先到「菜单管理」补种</p>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="dialogOpen = false">取消</button>
        <button class="btn-primary flex-1" :disabled="saving" @click="save">
          <Icon name="refresh" v-if="saving" class="animate-spin" /> 保存
        </button>
      </template>
    </ModalBase>

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除角色" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-slate-500 mt-2">
          确认删除角色 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.name }}</span>？
          其菜单授权与用户挂载将一并清除，操作不可撤销。
        </p>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="deleteTarget = null">取消</button>
        <button class="btn-danger flex-1" :disabled="deleting" @click="doDelete">
          <Icon name="refresh" v-if="deleting" class="animate-spin" />
          确认删除
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import {
  getAdminRoles, createRole, updateRole, deleteRole,
  getAdminMenus, getRoleAssignments, updateUserRoles,
  type AdminRole, type AdminMenu, type RoleAssignment,
} from '~/api/rbac'
import { getAdminUsers, type AdminUser } from '~/api/admin'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const roles = ref<AdminRole[]>([])
const menus = ref<AdminMenu[]>([])
const users = ref<AdminUser[]>([])
const assignments = ref<RoleAssignment[]>([])
const dialogOpen = ref(false)
const editingId = ref(0)
const deleteTarget = ref<AdminRole | null>(null)

const roleForm = reactive({ name: '', description: '', menu_ids: [] as number[] })

const superAdminSelected = computed(() => {
  const r = roles.value.find((x) => x.id === editingId.value)
  return !!r && r.is_system === 1 && r.name === '超级管理员'
})

const menuGroups = computed(() => {
  const meta: Record<string, string> = { main: '主菜单', admin: '管理员', bottom: '底部' }
  const order = ['main', 'admin', 'bottom']
  return order.map((key) => ({
    key,
    label: meta[key],
    items: menus.value.filter((m) => (m.group_name || 'main') === key),
  })).filter((g) => g.items.length)
})

function userRoleIds(userId: number): number[] {
  return assignments.value.filter((a) => a.user_id === userId).map((a) => a.role_id)
}

function toggleMenu(id: number, checked: boolean) {
  if (checked) {
    if (!roleForm.menu_ids.includes(id)) roleForm.menu_ids.push(id)
  } else {
    roleForm.menu_ids = roleForm.menu_ids.filter((v) => v !== id)
  }
}

async function reload() {
  loading.value = true
  try {
    const [roleData, menuData, userData, assignData] = await Promise.all([
      getAdminRoles(),
      getAdminMenus().catch(() => ({ items: [] as AdminMenu[] })),
      getAdminUsers().catch(() => [] as AdminUser[]),
      getRoleAssignments().catch(() => ({ assignments: [] as RoleAssignment[] })),
    ])
    roles.value = roleData.items
    menus.value = menuData.items
    users.value = userData as any as AdminUser[]
    assignments.value = assignData.assignments
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = 0
  roleForm.name = ''
  roleForm.description = ''
  roleForm.menu_ids = menus.value.filter((m) => m.enabled && !m.admin_only).map((m) => m.id)
  dialogOpen.value = true
}

function openEdit(r: AdminRole) {
  editingId.value = r.id
  roleForm.name = r.name
  roleForm.description = r.description
  roleForm.menu_ids = [...(r.menu_ids || [])]
  dialogOpen.value = true
}

async function save() {
  if (!roleForm.name.trim()) { toast.error('角色名称不能为空'); return }
  saving.value = true
  try {
    if (editingId.value) {
      await updateRole(editingId.value, {
        name: roleForm.name.trim(),
        description: roleForm.description,
        menu_ids: superAdminSelected.value ? undefined : roleForm.menu_ids,
      })
      toast.success('角色已更新')
    } else {
      await createRole({
        name: roleForm.name.trim(),
        description: roleForm.description,
        menu_ids: roleForm.menu_ids,
      })
      toast.success('角色已创建')
    }
    dialogOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleUserRole(u: AdminUser, roleId: number, checked: boolean) {
  const ids = userRoleIds(u.id)
  const next = checked ? [...ids, roleId] : ids.filter((v) => v !== roleId)
  try {
    await updateUserRoles(u.id, next)
    assignments.value = assignments.value.filter((a) => a.user_id !== u.id)
    for (const rid of next) assignments.value.push({ user_id: u.id, role_id: rid, username: u.username })
    toast.success('用户角色已更新')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function confirmDelete(r: AdminRole) {
  deleteTarget.value = r
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteRole(deleteTarget.value.id)
    toast.success('角色已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
