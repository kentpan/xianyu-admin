<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="代理订单" description="查看分销订单、利润、手续费与结算状态">
      <template #actions>
        <NuxtLink to="/distribution/docked" class="btn-secondary">
          <Icon name="handshake" /> 我的对接
        </NuxtLink>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Tabs -->
    <div class="card p-4">
      <div class="flex items-center gap-2 flex-wrap">
        <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            :class="activeTab === 'my' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500'"
            @click="switchTab('my')"
          >
            我的代理订单
          </button>
          <button
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            :class="activeTab === 'upstream' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500'"
            @click="switchTab('upstream')"
          >
            代理我的订单
          </button>
        </div>

        <div class="flex-1" />

        <select v-model="statusFilter" class="input !w-auto" @change="goPage(1)">
          <option value="">全部状态</option>
          <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>

        <div class="relative w-60">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input
            v-model="search"
            class="input pl-9"
            placeholder="订单号 / 买家 ID"
            @keyup.enter="goPage(1)"
          />
        </div>
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
                <th>订单号</th>
                <th>卡券</th>
                <th>层级</th>
                <th v-if="activeTab === 'my'">上游</th>
                <th v-else>分销商</th>
                <th>售价</th>
                <th>对接价</th>
                <th>利润</th>
                <th>手续费</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in items" :key="o.id" class="cursor-pointer" @click="openDetail(o)">
                <td class="font-mono text-xs text-slate-700 dark:text-slate-200">{{ o.order_no }}</td>
                <td class="max-w-[180px]">
                  <p class="truncate text-slate-800 dark:text-slate-100">{{ o.card_name || `#${o.card_id}` }}</p>
                  <p v-if="o.buyer_id" class="text-xs text-slate-400">买家: {{ o.buyer_id }}</p>
                </td>
                <td>
                  <span class="badge" :class="o.dock_level === 2
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'">
                    L{{ o.dock_level || 1 }}
                  </span>
                </td>
                <td>
                  <span class="text-slate-700 dark:text-slate-200">{{ activeTab === 'my'
                    ? (o.upstream_username || (o.owner_username ? `货主 ${o.owner_username}` : '—'))
                    : (o.dealer_username || '—') }}</span>
                </td>
                <td><span class="font-medium tabular-nums text-slate-900 dark:text-white">¥{{ o.sale_price || '0.00' }}</span></td>
                <td>
                  <span class="tabular-nums text-slate-700 dark:text-slate-200">¥{{ o.dock_price || o.card_price || '0.00' }}</span>
                  <p v-if="o.dock_level === 2 && o.level2_cost" class="text-xs text-slate-400">L2: ¥{{ o.level2_cost }}</p>
                </td>
                <td>
                  <span class="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">+¥{{ o.profit || '0.00' }}</span>
                </td>
                <td>
                  <span class="tabular-nums text-amber-600 dark:text-amber-400">¥{{ o.fee_amount || '0.00' }}</span>
                  <p class="text-xs text-slate-400">{{ o.fee_payer === 'dealer' ? '分销商付' : '货主付' }}</p>
                </td>
                <td>
                  <span class="badge" :class="statusMeta(o.status).cls">
                    <span class="w-1.5 h-1.5 rounded-full" :class="statusMeta(o.status).dot" />
                    {{ statusMeta(o.status).label }}
                  </span>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(o.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!items.length" message="暂无代理订单" icon="orders" />
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

    <!-- Detail modal -->
    <ModalBase v-model="detailOpen" title="代理订单详情" size="lg">
      <div v-if="detail" class="space-y-4">
        <div class="flex items-center gap-3 flex-wrap">
          <span class="badge" :class="statusMeta(detail.status).cls">
            <span class="w-1.5 h-1.5 rounded-full" :class="statusMeta(detail.status).dot" />
            {{ statusMeta(detail.status).label }}
          </span>
          <span class="badge" :class="detail.dock_level === 2
            ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
            : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'">
            L{{ detail.dock_level || 1 }}
          </span>
          <span class="font-mono text-xs text-slate-500">{{ detail.order_no }}</span>
        </div>

        <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <div>
            <p class="text-xs text-slate-400">售价</p>
            <p class="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">¥{{ detail.sale_price || '0.00' }}</p>
          </div>
          <div>
            <p class="text-xs text-slate-400">{{ detail.dock_level === 2 ? '一级成本' : '对接价' }}</p>
            <p class="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">¥{{ detail.dock_level === 2 ? (detail.level2_cost || '0.00') : (detail.dock_price || detail.card_price || '0.00') }}</p>
          </div>
          <div>
            <p class="text-xs text-slate-400">利润</p>
            <p class="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+¥{{ detail.profit || '0.00' }}</p>
          </div>
          <div>
            <p class="text-xs text-slate-400">手续费</p>
            <p class="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">¥{{ detail.fee_amount || '0.00' }}</p>
          </div>
        </div>

        <div class="space-y-2 text-sm">
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">卡券</span>
            <span class="col-span-2 text-slate-800 dark:text-slate-100">{{ detail.card_name || `#${detail.card_id}` }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">买家</span>
            <span class="col-span-2">{{ detail.buyer_id || '—' }}</span>
          </div>
          <div v-if="detail.dealer_username" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">分销商</span>
            <span class="col-span-2">{{ detail.dealer_username }}</span>
          </div>
          <div v-if="detail.upstream_username" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">上游分销商</span>
            <span class="col-span-2">{{ detail.upstream_username }}</span>
          </div>
          <div v-if="detail.owner_username" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">货主</span>
            <span class="col-span-2">{{ detail.owner_username }}</span>
          </div>
          <div v-if="detail.dock_level === 2" class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">二级成本</span>
            <span class="col-span-2 tabular-nums">¥{{ detail.level2_cost || '0.00' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">卡券原价</span>
            <span class="col-span-2 tabular-nums">¥{{ detail.card_price || '0.00' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">手续费承担方</span>
            <span class="col-span-2">{{ detail.fee_payer === 'dealer' ? '分销商' : '货主' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 dark:border-slate-700">
            <span class="text-slate-400">创建时间</span>
            <span class="col-span-2">{{ formatTime(detail.created_at) }}</span>
          </div>
          <div v-if="detail.settle_remark" class="grid grid-cols-3 gap-2 py-2">
            <span class="text-slate-400">结算备注</span>
            <span class="col-span-2 text-xs text-amber-600 dark:text-amber-400">{{ detail.settle_remark }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="detailOpen = false">关闭</button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getMyAgentOrders, getUpstreamAgentOrders, getAgentOrderDetail } from '~/api/distribution'
import type { AgentOrder } from '~/api/distribution'

definePageMeta({ layout: 'default' })

const toast = useToast()

const STATUS_OPTIONS = [
  { value: 'delivered', label: '已发货' },
  { value: 'settled', label: '已结算' },
  { value: 'failed', label: '结算失败' },
] as const

function statusMeta(s: string) {
  if (s === 'settled') return { label: '已结算', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', dot: 'bg-emerald-500' }
  if (s === 'failed') return { label: '结算失败', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300', dot: 'bg-rose-500' }
  return { label: '已发货', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300', dot: 'bg-sky-500' }
}

const loading = ref(false)
const items = ref<AgentOrder[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const activeTab = ref<'my' | 'upstream'>('my')
const search = ref('')
const statusFilter = ref('')

const detailOpen = ref(false)
const detail = ref<AgentOrder | null>(null)

function switchTab(tab: 'my' | 'upstream') {
  if (activeTab.value === tab) return
  activeTab.value = tab
  page.value = 1
  reload()
}

async function reload() {
  loading.value = true
  try {
    const query = {
      page: page.value,
      page_size: pageSize.value,
      search: search.value.trim() || undefined,
      status: statusFilter.value || undefined,
    }
    const r = activeTab.value === 'my'
      ? await getMyAgentOrders(query)
      : await getUpstreamAgentOrders(query)
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

async function openDetail(o: AgentOrder) {
  detail.value = o
  detailOpen.value = true
  try {
    const r = await getAgentOrderDetail(o.id)
    detail.value = r
  } catch (e: any) {
    // Keep the cached row data; detail fetch is best-effort
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
