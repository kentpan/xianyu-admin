<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="菜单管理" description="树状菜单配置：名称/路径/图标/分组/排序/可见性，侧边栏与服务端权限校验以本页数据为准">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate()">
          <Icon name="plus" /> 新增菜单
        </button>
      </template>
    </PageHeader>

    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <div class="table-wrap max-h-[65vh] overflow-y-auto">
          <table class="table">
            <thead>
              <tr>
                <th>菜单</th>
                <th>路径</th>
                <th>分组</th>
                <th>排序</th>
                <th>可见性</th>
                <th>状态</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in flatTree" :key="row.id">
                <td>
                  <div class="flex items-center gap-2" :style="{ paddingLeft: row.depth * 24 + 'px' }">
                    <Icon v-if="row.depth" name="chevronRight" class="text-slate-300" />
                    <Icon :name="row.icon || 'dashboard'" class="text-brand-500" />
                    <span class="font-medium text-slate-800 dark:text-white">{{ row.name }}</span>
                    <span v-if="row.id === rootOf(row)" class="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">根菜单</span>
                  </div>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ row.path }}</td>
                <td>
                  <span class="badge" :class="groupMeta(row.group_name).cls">{{ groupMeta(row.group_name).label }}</span>
                </td>
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
        <EmptyState v-if="!flatTree.length" message="暂无菜单 — 服务端会从导航配置自动补种" icon="menu" />
      </template>
    </div>

    <!-- Create / Edit modal -->
    <ModalBase v-model="dialogOpen" :title="editingId ? '编辑菜单' : '新增菜单'" @close="dialogOpen = false">
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
              <option value="main">主菜单</option>
              <option value="admin">管理员</option>
              <option value="bottom">底部</option>
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

    <!-- Delete confirm modal -->
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
  </div>
</template>

<script setup lang="ts">
import { getAdminMenus, createMenu, updateMenu, deleteMenu, type AdminMenu } from '~/api/rbac'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const items = ref<AdminMenu[]>([])
const dialogOpen = ref(false)
const editingId = ref(0)
const deleteTarget = ref<AdminMenu | null>(null)

const ICON_OPTIONS = [
  'dashboard', 'accounts', 'items', 'orders', 'ship', 'keywords', 'itemReply', 'cards', 'delivery',
  'channels', 'msgNotify', 'settings', 'users', 'logs', 'riskLogs', 'data', 'menu', 'shield',
  'activity', 'message', 'filter', 'store', 'link', 'handshake', 'coins', 'wallet', 'key',
  'sparkles', 'user', 'lock', 'server', 'database', 'disclaimer', 'about',
]

interface FlatRow extends AdminMenu { depth: number }

const flatTree = computed<FlatRow[]>(() => {
  const byParent = new Map<number, AdminMenu[]>()
  for (const m of items.value) {
    const key = m.parent_id || 0
    const list = byParent.get(key) || []
    list.push(m)
    byParent.set(key, list)
  }
  const out: FlatRow[] = []
  const walk = (parentId: number, depth: number) => {
    for (const m of byParent.get(parentId) || []) {
      out.push({ ...m, depth })
      if (depth < 2) walk(m.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
})

const form = reactive({
  parent_id: 0,
  name: '',
  path: '',
  icon: 'dashboard',
  group_name: 'main' as AdminMenu['group_name'],
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
    default: return { label: '主菜单', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' }
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
  form.group_name = 'main'
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

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
