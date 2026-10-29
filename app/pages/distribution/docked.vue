<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="我的对接" description="管理我已创建的一级/二级对接记录、提货链接、二级分销设置">
      <template #actions>
        <NuxtLink to="/distribution/supply" class="btn-secondary">
          <Icon name="store" /> 货源广场
        </NuxtLink>
        <NuxtLink to="/distribution/sub-supply" class="btn-secondary">
          <Icon name="link" /> 二级货源
        </NuxtLink>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Search -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input
            v-model="search"
            class="input pl-9"
            placeholder="搜索对接名称 / 卡券名称"
            @keyup.enter="goPage(1)"
          />
        </div>
        <select v-model="levelFilter" class="input !w-auto" @change="goPage(1)">
          <option value="">全部层级</option>
          <option value="1">一级</option>
          <option value="2">二级</option>
        </select>
        <select v-model="statusFilter" class="input !w-auto" @change="goPage(1)">
          <option value="">全部状态</option>
          <option value="1">启用</option>
          <option value="0">停用</option>
        </select>
        <p class="text-xs text-slate-400">共 {{ total }} 条</p>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>对接名称</th>
                <th>卡券</th>
                <th>层级</th>
                <th>对接价</th>
                <th>加价</th>
                <th>状态</th>
                <th>提货次数</th>
                <th>二级分销</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in items" :key="d.id">
                <td>
                  <p class="font-medium text-slate-800 dark:text-white">{{ d.dock_name }}</p>
                  <p v-if="d.remark" class="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{{ d.remark }}</p>
                </td>
                <td>
                  <p class="text-slate-700 dark:text-slate-200">{{ d.card_name || '—' }}</p>
                  <p v-if="d.card_owner_username" class="text-xs text-slate-400">货主: {{ d.card_owner_username }}</p>
                </td>
                <td>
                  <span class="badge" :class="d.level === 2
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'">
                    L{{ d.level }}
                  </span>
                </td>
                <td>
                  <span class="font-medium tabular-nums text-slate-900 dark:text-white">¥{{ d.card_price || '0.00' }}</span>
                </td>
                <td>
                  <span class="text-slate-700 dark:text-slate-200 tabular-nums">+¥{{ d.markup_amount || '0.00' }}</span>
                </td>
                <td>
                  <button
                    class="badge transition-colors cursor-pointer"
                    :class="d.status
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    :title="d.status ? '点击停用' : '点击启用'"
                    @click="toggleStatus(d)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="d.status ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ d.status ? '启用' : '停用' }}
                  </button>
                </td>
                <td>
                  <span class="tabular-nums text-slate-700 dark:text-slate-200">{{ d.delivery_count || 0 }}</span>
                </td>
                <td>
                  <template v-if="d.level === 1">
                    <button
                      v-if="!d.allow_sub_dock"
                      class="btn-ghost !py-1 !px-2 !text-xs text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                      @click="openSubDock(d)"
                    >
                      <Icon name="plus" /> 开启
                    </button>
                    <button
                      v-else
                      class="badge bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 cursor-pointer"
                      :title="`二级价 ¥${d.sub_dock_price}`"
                      @click="openSubDock(d)"
                    >
                      <Icon name="check" /> 已开启
                    </button>
                  </template>
                  <span v-else class="text-xs text-slate-400">—</span>
                </td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="复制提货链接" @click="copyPickupUrl(d)">
                      <Icon name="link" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(d)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="confirmDelete(d)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!items.length" message="还没有对接记录，去货源广场创建第一个对接吧" icon="link" />
      </template>

      <!-- Pagination -->
      <div v-if="total > pageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
        <p class="text-xs text-slate-500">共 {{ total }} 条，第 {{ page }} / {{ totalPages }} 页</p>
        <div class="flex items-center gap-1">
          <button class="btn-secondary !px-2.5 !py-1.5" :disabled="page <= 1" @click="goPage(page - 1)">
            <Icon name="chevronRight" class="rotate-180" />
          </button>
          <button class="btn-secondary !px-2.5 !py-1.5" :disabled="page >= totalPages" @click="goPage(page + 1)">
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
    </div>

    <!-- Edit modal -->
    <ModalBase v-model="editOpen" title="编辑对接记录" size="md">
      <div v-if="editTarget" class="space-y-4">
        <div>
          <label class="label">对接名称 <span class="text-red-500">*</span></label>
          <input v-model="editForm.dock_name" class="input" />
        </div>
        <div>
          <label class="label">加价金额</label>
          <input v-model="editForm.markup_amount" type="number" min="0" step="0.01" class="input" />
        </div>
        <div>
          <label class="label">备注</label>
          <textarea v-model="editForm.remark" rows="3" class="input"></textarea>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="editOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="saveEdit">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          保存
        </button>
      </template>
    </ModalBase>

    <!-- Sub-dock toggle modal -->
    <ModalBase v-model="subDockOpen" title="二级分销设置" size="md">
      <div v-if="subDockTarget" class="space-y-4">
        <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs text-slate-400">对接记录</span>
            <span class="font-medium text-slate-800 dark:text-white">{{ subDockTarget.dock_name }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-slate-400">卡券对接价</span>
            <span class="text-slate-700 dark:text-slate-200">¥{{ subDockTarget.card_price || '0.00' }}</span>
          </div>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="subDockForm.allow" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-sm text-slate-700 dark:text-slate-200">允许其他分销商创建二级对接</span>
        </label>
        <div v-if="subDockForm.allow">
          <label class="label">二级拿货价 <span class="text-red-500">*</span></label>
          <input v-model="subDockForm.sub_dock_price" type="number" min="0" step="0.01" class="input" placeholder="如 12.00" />
          <p class="text-xs text-slate-400 mt-1">二级分销商的提货价（通常高于一级对接价）</p>
        </div>
        <div v-if="subDockForm.allow">
          <label class="label">可见性</label>
          <select v-model="subDockForm.sub_dock_visibility" class="input">
            <option value="public">公开（所有分销商可见）</option>
            <option value="dealer_only">仅指定分销商</option>
          </select>
        </div>
        <div v-if="!subDockForm.allow && subDockTarget.allow_sub_dock" class="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-300">
          <Icon name="alert" class="inline mr-1" />
          关闭二级分销后，所有已存在的二级对接记录将自动停用。
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="subDockOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="saveSubDock">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          保存
        </button>
      </template>
    </ModalBase>

    <!-- Delete confirm -->
    <ModalBase :model-value="!!deleteTarget" title="删除对接记录" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认删除对接记录 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.dock_name }}</span>？
          <br />已生成的提货链接将立即失效。
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
import { getDockRecords, updateDockRecord, deleteDockRecord, toggleSubDock, getPickupUrl } from '~/api/distribution'
import type { DockRecord } from '~/api/distribution'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const items = ref<DockRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const search = ref('')
const levelFilter = ref('')
const statusFilter = ref('')

const editOpen = ref(false)
const editTarget = ref<DockRecord | null>(null)
const editForm = reactive({ dock_name: '', markup_amount: '0.00', remark: '' })

const subDockOpen = ref(false)
const subDockTarget = ref<DockRecord | null>(null)
const subDockForm = reactive({
  allow: false,
  sub_dock_price: '',
  sub_dock_visibility: 'public',
})

const deleteTarget = ref<DockRecord | null>(null)

async function reload() {
  loading.value = true
  try {
    const r = await getDockRecords({
      page: page.value,
      page_size: pageSize.value,
      search: search.value.trim() || undefined,
      level: levelFilter.value || undefined,
      status: statusFilter.value,
    })
    items.value = r.items || []
    total.value = r.total || 0
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function goPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  reload()
}

async function toggleStatus(d: DockRecord) {
  try {
    await updateDockRecord(d.id, { status: d.status ? 0 : 1 })
    d.status = d.status ? 0 : 1
    toast.success(d.status ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function copyPickupUrl(d: DockRecord) {
  try {
    const r = await getPickupUrl(d.id)
    const fullUrl = window.location.origin + r.url
    await navigator.clipboard.writeText(fullUrl)
    toast.success('提货链接已复制')
  } catch (e: any) {
    toast.error(e.message || '复制失败')
  }
}

function openEdit(d: DockRecord) {
  editTarget.value = d
  editForm.dock_name = d.dock_name
  editForm.markup_amount = d.markup_amount || '0.00'
  editForm.remark = d.remark || ''
  editOpen.value = true
}

async function saveEdit() {
  if (!editTarget.value) return
  if (!editForm.dock_name.trim()) {
    toast.error('对接名称不能为空')
    return
  }
  saving.value = true
  try {
    await updateDockRecord(editTarget.value.id, {
      dock_name: editForm.dock_name.trim(),
      markup_amount: editForm.markup_amount || '0.00',
      remark: editForm.remark.trim() || null,
    })
    toast.success('已保存')
    editOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function openSubDock(d: DockRecord) {
  subDockTarget.value = d
  subDockForm.allow = !!d.allow_sub_dock
  subDockForm.sub_dock_price = d.sub_dock_price || ''
  subDockForm.sub_dock_visibility = d.sub_dock_visibility || 'public'
  subDockOpen.value = true
}

async function saveSubDock() {
  if (!subDockTarget.value) return
  if (subDockForm.allow && !subDockForm.sub_dock_price) {
    toast.error('开启二级分销时必须指定二级拿货价')
    return
  }
  saving.value = true
  try {
    await toggleSubDock(subDockTarget.value.id, {
      allow: subDockForm.allow,
      sub_dock_price: subDockForm.allow ? subDockForm.sub_dock_price : undefined,
      sub_dock_visibility: subDockForm.allow ? subDockForm.sub_dock_visibility : undefined,
    })
    toast.success(subDockForm.allow ? '已开启二级分销' : '已关闭二级分销')
    subDockOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function confirmDelete(d: DockRecord) {
  deleteTarget.value = d
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteDockRecord(deleteTarget.value.id)
    toast.success('对接记录已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
