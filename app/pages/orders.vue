<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="订单管理" description="查看 / 同步 / 手动发货 / 导入导出订单">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-secondary" :disabled="syncing" @click="syncAll">
          <Icon name="refresh" :class="syncing ? 'animate-spin' : ''" /> 一键同步
        </button>
        <button class="btn-secondary" @click="openImport">
          <Icon name="upload" /> 导入
        </button>
        <button class="btn-secondary" @click="exportOrders">
          <Icon name="download" /> 导出JSON
        </button>
        <button class="btn-secondary" @click="exportCSV">
          <Icon name="download" /> 导出CSV
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label class="label">订单状态</label>
          <select v-model="filters.status" class="input" @change="reload">
            <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div>
          <label class="label">所属账号</label>
          <select v-model="filters.cookie_id" class="input" @change="reload">
            <option value="">全部账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="label">关键词搜索</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input
              v-model="filters.keyword"
              class="input pl-9"
              placeholder="订单号 / 买家 ID"
              @keyup.enter="reload"
            />
          </div>
        </div>
      </div>
      <!-- Advanced filters (collapsible) -->
      <div class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button class="text-xs text-brand-600 hover:underline flex items-center gap-1" @click="showAdvanced = !showAdvanced">
          <Icon name="chevronDown" :class="showAdvanced ? 'rotate-180' : ''" class="transition-transform" />
          {{ showAdvanced ? '收起高级筛选' : '展开高级筛选' }}
        </button>
        <div v-if="showAdvanced" class="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
          <div>
            <label class="label">开始日期</label>
            <input v-model="filters.dateFrom" type="date" class="input" @change="reload" />
          </div>
          <div>
            <label class="label">结束日期</label>
            <input v-model="filters.dateTo" type="date" class="input" @change="reload" />
          </div>
          <div>
            <label class="label">最小金额 (¥)</label>
            <input v-model="filters.amountMin" type="number" min="0" step="0.01" class="input" placeholder="0" @keyup.enter="reload" />
          </div>
          <div>
            <label class="label">最大金额 (¥)</label>
            <input v-model="filters.amountMax" type="number" min="0" step="0.01" class="input" placeholder="不限" @keyup.enter="reload" />
          </div>
        </div>
        <div v-if="showAdvanced" class="flex items-center gap-2 mt-3">
          <button class="btn-secondary !text-xs !py-1" @click="resetFilters">
            <Icon name="close" /> 重置筛选
          </button>
          <span v-if="hasActiveFilters" class="text-xs text-slate-400">有 {{ activeFilterCount }} 个高级筛选生效中</span>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <template v-else>
        <!-- Batch toolbar -->
        <div v-if="selectedIds.length" class="flex items-center gap-2 px-4 py-2.5 bg-brand-50 dark:bg-brand-900/20 border-b border-brand-200 dark:border-brand-800 rounded-t-lg">
          <span class="text-sm text-brand-700 dark:text-brand-300 font-medium">已选 {{ selectedIds.length }} 项</span>
          <div class="flex-1" />
          <button class="btn-secondary !py-1 !px-2.5 !text-xs" :disabled="batching" @click="batchAction('ship')">
            <Icon v-if="batching === 'ship'" name="refresh" class="animate-spin" />
            <Icon v-else name="truck" /> 批量发货
          </button>
          <button class="btn-secondary !py-1 !px-2.5 !text-xs" :disabled="!!batching" @click="batchAction('export')">
            <Icon name="download" /> 导出选中
          </button>
          <button class="btn-danger !py-1 !px-2.5 !text-xs" :disabled="batching === 'delete'" @click="batchAction('delete')">
            <Icon v-if="batching === 'delete'" name="refresh" class="animate-spin" />
            <Icon v-else name="trash" /> 批量删除
          </button>
          <button class="btn-ghost !py-1 !px-2.5 !text-xs" @click="selectedIds = []">取消</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="w-10">
                  <input type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" :checked="allSelected" :indeterminate.prop="someSelected" @change="toggleAll" />
                </th>
                <th>订单号</th>
                <th>商品</th>
                <th>买家</th>
                <th>金额</th>
                <th>状态</th>
                <th>收货人</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in orders" :key="o.order_id" class="cursor-pointer" :class="selectedIds.includes(o.order_id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''" @click="openDetail(o)">
                <td @click.stop><input type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" :value="o.order_id" v-model="selectedIds" /></td>
                <td class="font-mono text-xs">{{ o.order_id }}</td>
                <td class="max-w-[200px]">
                  <p class="truncate text-slate-800 dark:text-slate-100">{{ o.item_title || o.item_id || '—' }}</p>
                  <p v-if="o.spec_value" class="text-xs text-slate-400">{{ o.spec_name }}: {{ o.spec_value }}</p>
                </td>
                <td>{{ o.buyer_id || '—' }}</td>
                <td><span class="font-medium text-slate-700 dark:text-slate-200">¥{{ o.amount || '0' }}</span></td>
                <td><OrderStatusBadge :status="o.order_status" /></td>
                <td>
                  <template v-if="o.receiver_name">
                    <p class="text-slate-700 dark:text-slate-200">{{ o.receiver_name }}</p>
                    <p class="text-xs text-slate-400">{{ o.receiver_phone }}</p>
                  </template>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(o.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1" @click.stop>
                    <button class="btn-ghost !px-2 !py-1" title="查看详情" @click="openDetail(o)">
                      <Icon name="eye" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="同步" @click="refreshOne(o)">
                      <Icon name="refresh" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="手动发货" @click="manualShip(o)">
                      <Icon name="truck" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(o)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!orders.length" message="暂无订单数据" icon="orders" />
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

    <!-- Detail drawer -->
    <DetailDrawer v-model="detailOpen" :eyebrow="'订单详情'" :title="detail?.order_id || '—'">
      <div v-if="detail" class="space-y-5">
        <!-- Status -->
        <div class="flex items-center gap-3">
          <OrderStatusBadge :status="detail.order_status" />
          <select v-model="editForm.order_status" class="input !w-auto">
            <option v-for="o in statusOptions.filter(s => s.value !== 'all')" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>

        <!-- Basic info -->
        <div class="space-y-2 text-sm">
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">商品</span>
            <span class="col-span-2 text-slate-800 dark:text-slate-100">{{ detail.item_title || detail.item_id || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">买家</span>
            <span class="col-span-2">{{ detail.buyer_id || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">金额</span>
            <span class="col-span-2 font-medium">¥{{ detail.amount || '0' }} × {{ detail.quantity || 1 }}</span>
          </div>
          <div v-if="detail.spec_value" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">规格</span>
            <span class="col-span-2">{{ detail.spec_name }}: {{ detail.spec_value }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">所属账号</span>
            <span class="col-span-2">{{ detail.cookie_remark || detail.cookie_id || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">创建时间</span>
            <span class="col-span-2">{{ formatTime(detail.created_at) }}</span>
          </div>
        </div>

        <!-- Receiver editor -->
        <div class="space-y-3">
          <h4 class="font-medium text-slate-900 dark:text-white">收货信息</h4>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">收货人</label>
              <input v-model="editForm.receiver_name" class="input" />
            </div>
            <div>
              <label class="label">手机号</label>
              <input v-model="editForm.receiver_phone" class="input" />
            </div>
          </div>
          <div>
            <label class="label">城市</label>
            <input v-model="editForm.receiver_city" class="input" />
          </div>
          <div>
            <label class="label">详细地址</label>
            <textarea v-model="editForm.receiver_address" rows="2" class="input"></textarea>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="detailOpen = false">关闭</button>
        <button class="btn-secondary" @click="manualShip(detail)" :disabled="saving">
          <Icon name="truck" /> 手动发货
        </button>
        <button class="btn-primary" :disabled="saving" @click="saveDetail">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          保存
        </button>
      </template>
    </DetailDrawer>

    <!-- Import modal -->
    <ModalBase v-model="importOpen" title="导入订单" size="lg">
      <div class="space-y-3">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          粘贴订单 JSON 数组。支持字段：<code class="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700">order_id, item_id, buyer_id, amount, order_status, cookie_id, receiver_*</code>
        </p>
        <textarea v-model="importText" rows="12" class="input font-mono text-xs" placeholder='[{"order_id":"O-001","item_id":"I-1","amount":"29.9","order_status":"pending_ship","cookie_id":"acc-xxx","receiver_name":"张三","receiver_phone":"13800000000","receiver_address":"..."}]'></textarea>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="importOpen = false">取消</button>
        <button class="btn-primary" :disabled="importing" @click="doImport">
          <Icon name="upload" v-if="!importing" />
          <Icon name="refresh" v-else class="animate-spin" />
          确认导入
        </button>
      </template>
    </ModalBase>

    <!-- Batch delete confirmation with countdown -->
    <ModalBase :model-value="batchDeleteOpen" title="确认批量删除" size="sm" @update:model-value="cancelBatchDelete" @close="cancelBatchDelete">
      <div class="text-center py-2">
        <div class="w-14 h-14 mx-auto rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-500 mb-3 relative">
          <Icon name="alert" class="text-2xl" />
          <span v-if="batchDeleteCountdown > 0" class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center">
            {{ batchDeleteCountdown }}
          </span>
        </div>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          即将删除 <span class="font-bold text-rose-600">{{ selectedIds.length }}</span> 条订单
        </p>
        <p class="text-xs text-slate-400 mt-1">此操作不可撤销，请谨慎确认</p>
        <div v-if="batchDeleteCountdown > 0" class="mt-3 text-xs text-amber-600 dark:text-amber-400">
          <Icon name="clock" class="inline mr-1" /> {{ batchDeleteCountdown }} 秒后可确认
        </div>
        <div v-else class="mt-3 text-xs text-emerald-600 dark:text-emerald-400">
          <Icon name="check" class="inline mr-1" /> 可以确认删除了
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="cancelBatchDelete">取消</button>
        <button class="btn-danger flex-1" :disabled="batchDeleteCountdown > 0 || batching === 'delete'" @click="confirmBatchDelete">
          <Icon v-if="batching === 'delete'" name="refresh" class="animate-spin" />
          <Icon v-else name="trash" /> 确认删除
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

interface Order {
  order_id: string
  item_id: string | null
  buyer_id: string | null
  spec_name: string | null
  spec_value: string | null
  quantity: string | null
  amount: string | null
  order_status: string
  cookie_id: string | null
  chat_id: string
  is_bargain: number
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  receiver_city: string
  created_at: string
  updated_at: string
  item_title?: string | null
  cookie_remark?: string | null
}

interface AccountLite { id: string; remark: string }

const statusOptions = [
  { value: 'all', label: '全部' },
  { value: 'pending_ship', label: '待发货' },
  { value: 'shipped', label: '已发货' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
  { value: 'refunding', label: '退款中' },
  { value: 'processing', label: '处理中' },
  { value: 'unknown', label: '其他' },
]

const loading = ref(false)
const saving = ref(false)
const syncing = ref(false)
const orders = ref<Order[]>([])
const accounts = ref<AccountLite[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

// Batch operations
const selectedIds = ref<string[]>([])
const batching = ref<string | null>(null)
const allSelected = computed(() => orders.value.length > 0 && selectedIds.value.length === orders.value.length)
const someSelected = computed(() => selectedIds.value.length > 0 && selectedIds.value.length < orders.value.length)
function toggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  selectedIds.value = checked ? orders.value.map((o) => o.order_id) : []
}
// Batch delete confirmation with countdown
const batchDeleteOpen = ref(false)
const batchDeleteCountdown = ref(0)
let _countdownTimer: ReturnType<typeof setInterval> | null = null

async function batchAction(action: 'ship' | 'delete' | 'export') {
  if (!selectedIds.value.length) return
  if (action === 'delete') {
    // Open confirmation modal with 3s countdown (can't confirm until countdown ends)
    batchDeleteCountdown.value = 3
    batchDeleteOpen.value = true
    _countdownTimer = setInterval(() => {
      batchDeleteCountdown.value--
      if (batchDeleteCountdown.value <= 0) {
        if (_countdownTimer) clearInterval(_countdownTimer)
      }
    }, 1000)
    return
  }
  await doBatchAction(action)
}

async function confirmBatchDelete() {
  if (batchDeleteCountdown.value > 0) return
  batchDeleteOpen.value = false
  await doBatchAction('delete')
}

function cancelBatchDelete() {
  batchDeleteOpen.value = false
  if (_countdownTimer) clearInterval(_countdownTimer)
  batchDeleteCountdown.value = 0
}

async function doBatchAction(action: 'ship' | 'delete' | 'export') {
  if (!selectedIds.value.length) return
  batching.value = action
  try {
    const r = await api.post<{ affected?: number; count?: number; orders?: any[] }>(`/api/orders/batch`, { ids: selectedIds.value, action })
    if (action === 'export') {
      const blob = new Blob([JSON.stringify(r.orders || [], null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orders_batch_${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${r.count} 条订单`)
    } else {
      toast.success(action === 'ship' ? `已批量发货 ${r.affected} 条` : `已批量删除 ${r.affected} 条`)
      selectedIds.value = []
      reload()
    }
  } catch (e: any) {
    toast.error(e.message || '批量操作失败')
  } finally {
    batching.value = null
  }
}

const filters = reactive({ status: 'all', cookie_id: '', keyword: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '' })
const showAdvanced = ref(false)
const hasActiveFilters = computed(() => !!(filters.dateFrom || filters.dateTo || filters.amountMin || filters.amountMax))
const activeFilterCount = computed(() => [filters.dateFrom, filters.dateTo, filters.amountMin, filters.amountMax].filter(Boolean).length)
function resetFilters() {
  filters.dateFrom = ''
  filters.dateTo = ''
  filters.amountMin = ''
  filters.amountMax = ''
  reload()
}

const detailOpen = ref(false)
const detail = ref<Order | null>(null)
const editForm = reactive<any>({})

const importOpen = ref(false)
const importText = ref('')
const importing = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

async function reload() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (filters.status && filters.status !== 'all') params.status = filters.status
    if (filters.cookie_id) params.cookie_id = filters.cookie_id
    if (filters.keyword.trim()) params.keyword = filters.keyword.trim()
    if (filters.dateFrom) params.dateFrom = filters.dateFrom
    if (filters.dateTo) params.dateTo = filters.dateTo
    if (filters.amountMin) params.amountMin = filters.amountMin
    if (filters.amountMax) params.amountMax = filters.amountMax
    const qs = new URLSearchParams(params).toString()
    const [ordersData, accountsData] = await Promise.all([
      api.get<{ data: Order[]; total: number; page: number; pageSize: number }>(`/api/orders?${qs}`),
      api.get<AccountLite[]>('/api/accounts'),
    ])
    orders.value = ordersData.data
    total.value = ordersData.total
    accounts.value = accountsData
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  reload()
}

function openDetail(o: Order) {
  detail.value = o
  Object.assign(editForm, {
    order_status: o.order_status,
    receiver_name: o.receiver_name || '',
    receiver_phone: o.receiver_phone || '',
    receiver_address: o.receiver_address || '',
    receiver_city: o.receiver_city || '',
  })
  detailOpen.value = true
}

async function saveDetail() {
  if (!detail.value) return
  saving.value = true
  try {
    await api.put(`/api/orders/${encodeURIComponent(detail.value.order_id)}`, { ...editForm })
    toast.success('订单已更新')
    Object.assign(detail.value, editForm)
    detailOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function refreshOne(o: Order) {
  try {
    await api.post(`/api/orders/${encodeURIComponent(o.order_id)}/refresh`)
    toast.success(`订单 ${o.order_id} 已同步`)
  } catch (e: any) {
    toast.error(e.message || '同步失败')
  }
}

async function syncAll() {
  if (!orders.value.length) {
    toast.info('当前没有可同步的订单')
    return
  }
  syncing.value = true
  let ok = 0
  let fail = 0
  await Promise.all(orders.value.map(async (o) => {
    try {
      await api.post(`/api/orders/${encodeURIComponent(o.order_id)}/refresh`)
      ok++
    } catch {
      fail++
    }
  }))
  syncing.value = false
  toast.success(`已同步 ${ok} 个订单${fail ? `，失败 ${fail}` : ''}`)
  reload()
}

async function manualShip(o: Order | null) {
  if (!o) return
  try {
    await api.post('/api/orders/manual-ship', { order_id: o.order_id, mode: 'status_only' })
    toast.success(`订单 ${o.order_id} 已标记为已发货`)
    if (detailOpen.value) detailOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '发货失败')
  }
}

async function deleteOne(o: Order) {
  if (!confirm(`确认删除订单「${o.order_id}」？`)) return
  try {
    await api.del(`/api/orders/${encodeURIComponent(o.order_id)}`)
    toast.success('订单已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  }
}

function openImport() {
  importText.value = ''
  importOpen.value = true
}

async function doImport() {
  let arr: any[] = []
  try {
    arr = JSON.parse(importText.value)
    if (!Array.isArray(arr)) throw new Error('JSON 必须是数组')
  } catch (e: any) {
    toast.error('JSON 格式错误: ' + e.message)
    return
  }
  importing.value = true
  try {
    const r = await api.post<{ inserted: number; updated: number }>('/api/orders/import', { orders: arr })
    toast.success(`已导入 ${r.inserted} 条，更新 ${r.updated} 条`)
    importOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '导入失败')
  } finally {
    importing.value = false
  }
}

async function exportOrders() {
  try {
    const r = await api.get<{ orders: Order[]; count: number }>('/api/orders/export')
    const blob = new Blob([JSON.stringify(r.orders, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orders-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${r.count} 个订单`)
  } catch (e: any) {
    toast.error(e.message || '导出失败')
  }
}

async function exportCSV() {
  try {
    const r = await api.get<{ orders: Order[]; count: number }>('/api/orders/export')
    const headers = ['订单号', '商品ID', '买家', '金额', '状态', '规格', '收货人', '手机号', '地址', '城市', '创建时间']
    const rows = r.orders.map((o) => [
      o.order_id, o.item_id || '', o.buyer_id || '', o.amount || '', o.order_status || '',
      o.spec_value ? `${o.spec_name}:${o.spec_value}` : '',
      o.receiver_name || '', o.receiver_phone || '', o.receiver_address || '', o.receiver_city || '',
      o.created_at || '',
    ])
    // useApi 会自动加 basePath；csv 端点返回原始 CSV 字符串（无 success 信封），useApi 会原样透传
    const csv = await api.post<string>('/api/export/csv', { filename: `orders-${Date.now()}.csv`, headers, rows })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orders-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${r.count} 条订单到 CSV`)
  } catch (e: any) {
    toast.error(e.message || 'CSV导出失败')
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(t.replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Read initial cookie_id filter from URL (e.g. linked from items page)
const route = useRoute()
onMounted(() => {
  const cid = route.query.cookie_id as string
  if (cid) filters.cookie_id = cid
  reload()
})
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
