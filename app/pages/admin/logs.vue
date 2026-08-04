<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="系统日志" description="按级别 / 模块 / 关键词检索系统日志">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-danger" :disabled="clearing" @click="clearAll">
          <Icon name="trash" /> 清空日志
        </button>
      </template>
    </PageHeader>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
      <StatCard v-for="s in statsCards" :key="s.key" :label="s.label" :value="s.value" :icon="s.icon" :color="s.color" />
    </div>

    <!-- Filters -->
    <div class="card p-4">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label class="label">级别</label>
          <select v-model="filters.level" class="input" @change="resetAndReload">
            <option value="ALL">全部</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
            <option value="DEBUG">DEBUG</option>
          </select>
        </div>
        <div>
          <label class="label">模块</label>
          <input v-model="filters.module" class="input" placeholder="如 auth / order" @keyup.enter="resetAndReload" />
        </div>
        <div class="md:col-span-2">
          <label class="label">关键词</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input v-model="filters.keyword" class="input pl-9" placeholder="搜索日志消息" @keyup.enter="resetAndReload" />
          </div>
        </div>
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
                <th class="w-44">时间</th>
                <th class="w-24">级别</th>
                <th class="w-32">模块</th>
                <th>消息</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in logs" :key="l.id">
                <td class="text-slate-500 dark:text-slate-400 text-xs font-mono">{{ formatTime(l.created_at) }}</td>
                <td>
                  <span class="badge" :class="levelMeta(l.level).cls">
                    <span class="w-1.5 h-1.5 rounded-full" :class="levelMeta(l.level).dot" />
                    {{ l.level }}
                  </span>
                </td>
                <td class="text-slate-600 dark:text-slate-300 text-xs">{{ l.module || '—' }}</td>
                <td class="whitespace-normal break-words max-w-[600px] text-slate-700 dark:text-slate-200">{{ l.message }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!logs.length" message="没有匹配的日志" icon="logs" />
      </template>

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
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

interface Log {
  id: number
  level: string
  module: string | null
  message: string
  meta: string | null
  user_id: number | null
  created_at: string
}

const LEVEL_META: Record<string, { cls: string; dot: string; icon: string }> = {
  INFO: { cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300', dot: 'bg-sky-500', icon: 'info' },
  WARN: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', dot: 'bg-amber-500', icon: 'alert' },
  ERROR: { cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300', dot: 'bg-rose-500', icon: 'alert' },
  DEBUG: { cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300', dot: 'bg-slate-400', icon: 'activity' },
}
function levelMeta(l: string) { return LEVEL_META[l] || LEVEL_META.INFO }

const loading = ref(false)
const clearing = ref(false)
const logs = ref<Log[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filters = reactive({ level: 'ALL', module: '', keyword: '' })

const stats = ref<Record<string, number>>({})
const statsTotal = ref(0)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const statsCards = computed(() => [
  { key: 'total', label: '总日志', value: statsTotal.value, icon: 'logs', color: 'slate' as const },
  { key: 'INFO', label: 'INFO', value: stats.value.INFO || 0, icon: 'info', color: 'sky' as const },
  { key: 'WARN', label: 'WARN', value: stats.value.WARN || 0, icon: 'alert', color: 'amber' as const },
  { key: 'ERROR', label: 'ERROR', value: stats.value.ERROR || 0, icon: 'alert', color: 'rose' as const },
  { key: 'DEBUG', label: 'DEBUG', value: stats.value.DEBUG || 0, icon: 'activity', color: 'slate' as const },
])

async function reload() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (filters.level && filters.level !== 'ALL') params.level = filters.level
    if (filters.module.trim()) params.module = filters.module.trim()
    if (filters.keyword.trim()) params.keyword = filters.keyword.trim()
    const qs = new URLSearchParams(params).toString()

    const [logsData, statsData] = await Promise.all([
      api.get<{ data: Log[]; total: number; page: number; pageSize: number }>(`/api/admin/logs?${qs}`),
      api.get<{ stats: Record<string, number>; total: number }>('/api/admin/logs/stats'),
    ])
    logs.value = logsData.data
    total.value = logsData.total
    stats.value = statsData.stats || {}
    statsTotal.value = statsData.total || 0
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function resetAndReload() {
  page.value = 1
  reload()
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  reload()
}

async function clearAll() {
  if (!confirm('确认清空所有日志？此操作不可撤销。')) return
  clearing.value = true
  try {
    const level = filters.level !== 'ALL' ? filters.level : ''
    await api.post('/api/admin/logs/clear', level ? { level } : {})
    toast.success('日志已清空')
    page.value = 1
    reload()
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  } finally {
    clearing.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(t.replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
