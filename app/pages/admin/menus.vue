<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="菜单管理" description="按分组管理菜单：名称/路径/图标/排序/可见性，侧边栏与服务端权限校验以本页数据为准">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-secondary" @click="openGroupConfig">
          <Icon name="settings" /> 分组配置
        </button>
        <button class="btn-primary" @click="openCreate()">
          <Icon name="plus" /> 新增菜单
        </button>
      </template>
    </PageHeader>

    <div v-if="loading" class="card p-10 flex items-center justify-center text-slate-400">
      <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
    </div>
    <template v-else>
      <!-- 按分组显示: 每组一张卡, 组内树状列表 -->
      <div v-for="g in groupedMenus" :key="g.key" class="card overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Icon name="menu" class="text-brand-500" />
          <span class="font-medium text-slate-800 dark:text-white">{{ g.label }}</span>
          <span class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ g.key }}</span>
          <span v-if="g.label !== groupMeta(g.key).label" class="badge" :class="groupMeta(g.key).cls">{{ groupMeta(g.key).label }}</span>
          <span class="badge" :class="g.key === 'admin' ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'">
            {{ g.items.length }} 项
          </span>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>菜单</th>
                <th>路径</th>
                <th>排序</th>
                <th>可见性</th>
                <th>状态</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in g.items" :key="row.id">
                <td>
                  <div class="flex items-center gap-2" :style="{ paddingLeft: row.depth * 24 + 'px' }">
                    <Icon v-if="row.depth" name="chevronRight" class="text-slate-300" />
                    <Icon :name="row.icon || 'dashboard'" class="text-brand-500" />
                    <span class="font-medium text-slate-800 dark:text-white">{{ row.name }}</span>
                    <span v-if="row.id === rootOf(row)" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">根菜单</span>
                  </div>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ row.path }}</td>
                <td class="text-slate-500 dark:text-slate-400">{{ row.sort_order }}</td>
                <td>
                  <span class="badge" :class="row.admin_only ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300'">
                    <Icon :name="row.admin_only ? 'lock' : 'users'" />
                    {{ row.admin_only ? '仅管理员' : '全部用户' }}
                  </span>
                </td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="row.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    @click="toggleEnabled(row)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="row.enabled ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ row.enabled ? '启用' : '停用' }}
                  </button>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="添加子菜单" @click="openCreate(row.id)">
                      <Icon name="plus" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(row)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="confirmDelete(row)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="!groupedMenus.length" class="card">
        <EmptyState message="暂无菜单 — 服务端会从导航配置自动补种" icon="menu" />
      </div>
    </template>

    <!-- Create / Edit menu modal -->
    <ModalBase v-model="dialogOpen" :title="editingId ? '编辑菜单' : '新增菜单'" size="lg" @close="dialogOpen = false">
      <div class="space-y-4 py-1">
        <div>
          <label class="block mb-1.5 text-slate-600 dark:text-slate-300">父级菜单</label>
          <select v-model="form.parent_id" class="input w-full">
            <option :value="0">无 (根菜单)</option>
            <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">菜单名称 <span class="text-red-500">*</span></label>
            <input v-model="form.name" class="input w-full" placeholder="如：菜单管理" />
          </div>
          <div>
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">路径 <span class="text-red-500">*</span></label>
            <input v-model="form.path" class="input w-full" placeholder="如：/admin/menus" />
          </div>
          <div>
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">图标</label>
            <select v-model="form.icon" class="input w-full">
              <option v-for="i in ICON_OPTIONS" :key="i" :value="i">{{ i }}</option>
            </select>
          </div>
          <div>
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">分组</label>
            <select v-model="form.group_name" class="input w-full">
              <option v-for="g in groups" :key="g.key" :value="g.key">{{ g.label }} ({{ g.key }})</option>
            </select>
          </div>
          <div>
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">排序 (越小越靠前)</label>
            <input v-model.number="form.sort_order" type="number" min="0" class="input w-full" />
          </div>
          <div class="flex items-end gap-6 pb-2">
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input v-model="form.admin_only" type="checkbox" class="w-4 h-4 accent-brand-500" />
              <span class="text-slate-600 dark:text-slate-300">仅管理员可见</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input v-model="form.enabled" type="checkbox" class="w-4 h-4 accent-brand-500" />
              <span class="text-slate-600 dark:text-slate-300">启用</span>
            </label>
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

    <!-- 分组配置 modal: 分组列表 + CRUD -->
    <ModalBase v-model="groupOpen" title="分组配置" size="lg" @close="groupOpen = false">
      <div class="space-y-4 py-1">
        <!-- 新增分组 -->
        <div class="flex flex-wrap items-end gap-3 pb-3 border-b border-slate-100 dark:border-slate-700">
          <div class="w-44">
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">key <span class="text-red-500">*</span></label>
            <input v-model="groupForm.key" class="input w-full" placeholder="如：ops (小写字母开头)" />
          </div>
          <div class="w-44">
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">分组名称 <span class="text-red-500">*</span></label>
            <input v-model="groupForm.label" class="input w-full" placeholder="如：运营" />
          </div>
          <div class="w-28">
            <label class="block mb-1.5 text-slate-600 dark:text-slate-300">排序</label>
            <input v-model.number="groupForm.sort_order" type="number" min="0" class="input w-full" />
          </div>
          <button class="btn-primary" :disabled="groupSaving" @click="createGroup">
            <Icon name="plus" /> 新增分组
          </button>
        </div>
        <!-- 分组列表 -->
        <div class="table-wrap max-h-80 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg">
          <table class="table">
            <thead>
              <tr>
                <th>分组名称</th>
                <th>key</th>
                <th>菜单数</th>
                <th>排序</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in groupRows" :key="g.id">
                <td>
                  <template v-if="groupEditId === g.id">
                    <input v-model="groupEditForm.label" class="input !h-8 !py-1 w-40" />
                  </template>
                  <template v-else>
                    <span class="font-medium text-slate-800 dark:text-white">{{ g.label }}</span>
                    <span v-if="g.is_system" class="badge ml-2 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">内置</span>
                  </template>
                </td>
                <td>
                  <template v-if="groupEditId === g.id && !g.is_system">
                    <input v-model="groupEditForm.key" class="input !h-8 !py-1 w-36" />
                  </template>
                  <template v-else>
                    <span class="font-mono text-slate-500 dark:text-slate-400">{{ g.key }}</span>
                  </template>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ g.menu_count ?? 0 }} 项</td>
                <td>
                  <template v-if="groupEditId === g.id">
                    <input v-model.number="groupEditForm.sort_order" type="number" min="0" class="input !h-8 !py-1 w-20" />
                  </template>
                  <template v-else>
                    <span class="text-slate-500 dark:text-slate-400">{{ g.sort_order }}</span>
                  </template>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <template v-if="groupEditId === g.id">
                      <button class="btn-ghost !px-2 !py-1 text-emerald-600" title="保存" @click="saveGroupEdit(g)">
                        <Icon name="check" />
                      </button>
                      <button class="btn-ghost !px-2 !py-1" title="取消" @click="groupEditId = 0">
                        <Icon name="x" />
                      </button>
                    </template>
                    <template v-else>
                      <button class="btn-ghost !px-2 !py-1" title="编辑" @click="startGroupEdit(g)">
                        <Icon name="edit" />
                      </button>
                      <button
                        class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        :title="g.is_system ? '内置分组不可删除' : '删除分组'"
                        :disabled="!!g.is_system"
                        @click="confirmGroupDelete(g)"
                      >
                        <Icon name="trash" />
                      </button>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <EmptyState v-if="!groupRows.length" message="暂无分组 — 服务端启动时会自动补种内置分组" icon="menu" />
        </div>
        <p class="text-slate-400">说明：内置分组 (主菜单/管理员/其他) 可改名称与排序、不可删除；自定义组 key 修改会同步迁移组下菜单；组下仍有菜单时不可删除。</p>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="groupOpen = false">完成</button>
      </template>
    </ModalBase>

    <!-- Delete menu confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除菜单" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-slate-500 mt-2">
          确认删除菜单 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.name }}</span>？
          该菜单的角色授权将一并清除，操作不可撤销。
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

    <!-- Delete group confirm modal -->
    <ModalBase :model-value="!!groupDeleteTarget" title="删除分组" size="sm" @update:model-value="groupDeleteTarget = null" @close="groupDeleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-slate-500 mt-2">
          确认删除分组 <span class="font-medium text-slate-800 dark:text-slate-200">{{ groupDeleteTarget?.label }}</span>？
          组下仍有菜单时删除会被拒绝。
        </p>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="groupDeleteTarget = null">取消</button>
        <button class="btn-danger flex-1" :disabled="groupSaving" @click="doGroupDelete">
          <Icon name="refresh" v-if="groupSaving" class="animate-spin" />
          确认删除
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import {
  getAdminMenus, createMenu, updateMenu, deleteMenu,
  getMenuGroupsAdmin, createMenuGroup, updateMenuGroup, deleteMenuGroup,
  type AdminMenu, type MenuGroup,
} from '~/api/rbac'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const items = ref<AdminMenu[]>([])
const groups = ref<MenuGroup[]>([])
const dialogOpen = ref(false)
const editingId = ref(0)
const deleteTarget = ref<AdminMenu | null>(null)

const groupOpen = ref(false)
const groupRows = ref<MenuGroup[]>([])
const groupSaving = ref(false)
const groupEditId = ref(0)
const groupEditForm = reactive({ key: '', label: '', sort_order: 0 })
const groupDeleteTarget = ref<MenuGroup | null>(null)
const groupForm = reactive({ key: '', label: '', sort_order: 0 })

const ICON_OPTIONS = [
  'dashboard', 'accounts', 'items', 'orders', 'ship', 'keywords', 'itemReply', 'cards', 'delivery',
  'channels', 'msgNotify', 'settings', 'users', 'logs', 'riskLogs', 'data', 'menu', 'shield',
  'activity', 'message', 'filter', 'store', 'link', 'handshake', 'coins', 'wallet', 'key',
  'sparkles', 'user', 'lock', 'server', 'database', 'disclaimer', 'about',
]

interface FlatRow extends AdminMenu { depth: number }

/** 按分组段输出: 组排序 = menu_groups 表 sort_order; 组内树状平铺。 */
const groupedMenus = computed<Array<{ key: string; label: string; items: FlatRow[] }>>(() => {
  const meta: Array<{ key: string; label: string }> = groups.value.length
    ? groups.value.map((g) => ({ key: g.key, label: g.label }))
    : [
        { key: 'main', label: '主菜单' },
        { key: 'admin', label: '管理员' },
        { key: 'bottom', label: '其他' },
      ]
  const out: Array<{ key: string; label: string; items: FlatRow[] }> = []
  for (const g of meta) {
    const inGroup = items.value.filter((m) => (m.group_name || 'main') === g.key)
    if (!inGroup.length) continue
    out.push({ key: g.key, label: g.label, items: flatTreeOf(inGroup) })
  }
  // 脏数据兜底: 菜单挂在不存在的分组上时归入「未分组」段, 绝不静默丢菜单
  const known = new Set(meta.map((g) => g.key))
  const orphans = items.value.filter((m) => !known.has(m.group_name || 'main'))
  if (orphans.length) out.push({ key: '__ungrouped', label: '未分组', items: flatTreeOf(orphans) })
  return out
})

function flatTreeOf(list: AdminMenu[]): FlatRow[] {
  const byParent = new Map<number, AdminMenu[]>()
  for (const m of list) {
    const key = m.parent_id || 0
    const arr = byParent.get(key) || []
    arr.push(m)
    byParent.set(key, arr)
  }
  const rows: FlatRow[] = []
  const walk = (parentId: number, depth: number) => {
    for (const m of byParent.get(parentId) || []) {
      rows.push({ ...m, depth })
      if (depth < 2) walk(m.id, depth + 1)
    }
  }
  walk(0, 0)
  return rows
}

const form = reactive({
  parent_id: 0,
  name: '',
  path: '',
  icon: 'dashboard',
  group_name: 'main',
  sort_order: 0,
  admin_only: false,
  enabled: true,
})

const parentOptions = computed(() =>
  items.value
    .filter((m) => m.id !== editingId.value)
    .map((m) => ({ id: m.id, label: `${m.name} (${m.path})` })),
)

function groupMeta(g: string) {
  switch (g) {
    case 'admin': return { label: '管理员', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' }
    case 'bottom': return { label: '底部', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400' }
    case 'main': return { label: '主菜单', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' }
    default: return { label: '自定义', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
  }
}

function rootOf(row: AdminMenu): number {
  return row.parent_id ? row.parent_id : row.id
}

async function reload() {
  loading.value = true
  try {
    const data = await getAdminMenus()
    items.value = data.items
    if (data.groups?.length) groups.value = data.groups
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.parent_id = 0
  form.name = ''
  form.path = ''
  form.icon = 'dashboard'
  form.group_name = groups.value[0]?.key || 'main'
  form.sort_order = items.value.length
  form.admin_only = false
  form.enabled = true
}

function openCreate(parentId = 0) {
  editingId.value = 0
  resetForm()
  form.parent_id = parentId
  dialogOpen.value = true
}

function openEdit(row: AdminMenu) {
  editingId.value = row.id
  form.parent_id = row.parent_id || 0
  form.name = row.name
  form.path = row.path
  form.icon = row.icon
  form.group_name = row.group_name
  form.sort_order = row.sort_order
  form.admin_only = !!row.admin_only
  form.enabled = !!row.enabled
  dialogOpen.value = true
}

async function save() {
  if (!form.name.trim()) { toast.error('菜单名称不能为空'); return }
  if (!form.path.trim().startsWith('/')) { toast.error('路径必须以 / 开头'); return }
  saving.value = true
  try {
    const payload = {
      parent_id: form.parent_id,
      name: form.name.trim(),
      path: form.path.trim(),
      icon: form.icon,
      group_name: form.group_name,
      sort_order: form.sort_order,
      admin_only: form.admin_only,
      enabled: form.enabled,
    }
    if (editingId.value) await updateMenu(editingId.value, payload)
    else await createMenu(payload)
    toast.success(editingId.value ? '菜单已更新' : '菜单已创建')
    dialogOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(row: AdminMenu) {
  try {
    await updateMenu(row.id, { enabled: !row.enabled })
    row.enabled = row.enabled ? 0 : 1
    toast.success(row.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function confirmDelete(row: AdminMenu) {
  deleteTarget.value = row
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteMenu(deleteTarget.value.id)
    toast.success('菜单已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

/* ---------------- 分组配置 ---------------- */

async function loadGroups() {
  const data = await getMenuGroupsAdmin()
  groupRows.value = data.items
  groups.value = data.items
}

function openGroupConfig() {
  groupEditId.value = 0
  groupForm.key = ''
  groupForm.label = ''
  groupForm.sort_order = groupRows.value.length
  groupOpen.value = true
  loadGroups().catch((e: any) => toast.error(e.message || '分组加载失败'))
}

async function createGroup() {
  if (!groupForm.key.trim() || !groupForm.label.trim()) { toast.error('key 与分组名称不能为空'); return }
  groupSaving.value = true
  try {
    await createMenuGroup({ key: groupForm.key.trim(), label: groupForm.label.trim(), sort_order: groupForm.sort_order })
    toast.success('分组已创建')
    groupForm.key = ''
    groupForm.label = ''
    groupForm.sort_order = groupRows.value.length + 1
    await loadGroups()
    await reload()
  } catch (e: any) {
    toast.error(e.message || '创建失败')
  } finally {
    groupSaving.value = false
  }
}

function startGroupEdit(g: MenuGroup) {
  groupEditId.value = g.id
  groupEditForm.key = g.key
  groupEditForm.label = g.label
  groupEditForm.sort_order = g.sort_order
}

async function saveGroupEdit(g: MenuGroup) {
  groupSaving.value = true
  try {
    await updateMenuGroup(g.id, {
      label: groupEditForm.label.trim(),
      sort_order: groupEditForm.sort_order,
      ...(g.is_system ? {} : { key: groupEditForm.key.trim() }),
    })
    toast.success('分组已更新')
    groupEditId.value = 0
    await loadGroups()
    await reload()
  } catch (e: any) {
    toast.error(e.message || '更新失败')
  } finally {
    groupSaving.value = false
  }
}

function confirmGroupDelete(g: MenuGroup) {
  groupDeleteTarget.value = g
}

async function doGroupDelete() {
  if (!groupDeleteTarget.value) return
  groupSaving.value = true
  try {
    await deleteMenuGroup(groupDeleteTarget.value.id)
    toast.success('分组已删除')
    groupDeleteTarget.value = null
    await loadGroups()
    await reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    groupSaving.value = false
  }
}

onMounted(async () => {
  await reload()
  loadGroups().catch(() => {})
})
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
