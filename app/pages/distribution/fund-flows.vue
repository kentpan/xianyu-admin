<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="资金流水" description="查看账户余额变动明细（收入 / 支出 / 手续费）">
      <template #actions>
        <NuxtLink to="/wallet" class="btn-secondary">
          <Icon name="wallet" /> 我的钱包
        </NuxtLink>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            v-for="t in TYPE_OPTIONS"
            :key="t.value"
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            :class="typeFilter === t.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500'"
            @click="setType(t.value)"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input
            v-model="search"
            class="input pl-9"
            placeholder="搜索流水描述"
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
                <th>类型</th>
                <th>金额</th>
                <th>变动前</th>
                <th>变动后</th>
                <th>描述</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in items" :key="f.id">
                <td>
                  <span class="badge" :class="typeMeta(f.type).cls">
                    <Icon :name="typeMeta(f.type).icon" /> {{ typeMeta(f.type).label }}
                  </span>
                </td>
                <td>
                  <span class="font-semibold tabular-nums" :class="amountClass(f.type)">
                    {{ amountDisplay(f.type, f.amount) }}
                  </span>
                </td>
                <td><span class="tabular-nums text-slate-500 dark:text-slate-400">¥{{ f.balance_before || '0.00' }}</span></td>
                <td><span class="tabular-nums font-medium text-slate-700 dark:text-slate-200">¥{{ f.balance_after || '0.00' }}</span></td>
                <td class="max-w-[360px]">
                  <p class="truncate text-slate-700 dark:text-slate-200" :title="f.description">{{ f.description || '—' }}</p>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(f.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!items.length" message="暂无资金流水" icon="coins" />
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
  </div>
</template>

<script setup lang="ts">
import { getFundFlows } from '~/api/distribution'
import type { FundFlow } from '~/api/distribution'

definePageMeta({ layout: 'default' })

const toast = useToast()

const TYPE_OPTIONS = [
  { value: '',       label: '全部',     icon: 'filter',    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300' },
  { value: 'income',  label: '收入',     icon: 'trendUp',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'expense', label: '支出',     icon: 'trendDown', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  { value: 'fee',     label: '手续费',   icon: 'coins',     cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
] as const

function typeMeta(t: string) {
  return (
    TYPE_OPTIONS.find((o) => o.value === t && o.value !== '') ||
    {
      income: { label: '收入',   icon: 'trendUp',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
      expense: { label: '支出',  icon: 'trendDown', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
      fee: { label: '手续费',    icon: 'coins',     cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    }[t] || { label: t || '—', icon: 'info', cls: 'bg-slate-100 text-slate-500' }
  )
}

function amountClass(type: string) {
  if (type === 'income') return 'text-emerald-600 dark:text-emerald-400'
  if (type === 'expense') return 'text-rose-600 dark:text-rose-400'
  if (type === 'fee') return 'text-amber-600 dark:text-amber-400'
  return 'text-slate-700 dark:text-slate-200'
}

function amountDisplay(type: string, amount: string) {
  const a = amount || '0.00'
  if (type === 'income') return `+¥${a}`
  if (type === 'expense') return `-¥${a}`
  if (type === 'fee') return `-¥${a}`
  return `¥${a}`
}

const loading = ref(false)
const items = ref<FundFlow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const search = ref('')
const typeFilter = ref('')

async function reload() {
  loading.value = true
  try {
    const r = await getFundFlows({
      page: page.value,
      page_size: pageSize.value,
      type: typeFilter.value || undefined,
      search: search.value.trim() || undefined,
    })
    items.value = r.items || []
    total.value = r.total || 0
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function setType(t: string) {
  typeFilter.value = t
  goPage(1)
}

function goPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  reload()
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
