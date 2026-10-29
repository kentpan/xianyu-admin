<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="风控日志" description="记录闲鱼账号风控事件与处理结果">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label class="label">账号 ID</label>
          <input v-model="filters.cookie_id" class="input" placeholder="精确匹配" @keyup.enter="resetAndReload" />
        </div>
        <div>
          <label class="label">处理状态</label>
          <select v-model="filters.status" class="input" @change="resetAndReload">
            <option value="">全部</option>
            <option value="processing">处理中</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
            <option value="manual">需人工</option>
          </select>
        </div>
        <div class="flex items-end">
          <button class="btn-secondary w-full" @click="resetAndReload">
            <Icon name="search" /> 查询
          </button>
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
                <th>账号</th>
                <th class="w-32">事件类型</th>
                <th>描述</th>
                <th class="w-24">状态</th>
                <th>错误信息</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in logs" :key="r.id">
                <td class="text-slate-500 dark:text-slate-400 text-xs font-mono">{{ formatTime(r.created_at) }}</td>
                <td class="font-mono text-xs">{{ r.cookie_id }}</td>
                <td>
                  <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">{{ r.event_type || '—' }}</span>
                </td>
                <td class="whitespace-normal break-words max-w-[280px] text-sm">{{ r.event_description || '—' }}</td>
                <td>
                  <span class="badge" :class="statusMeta(r.processing_status).cls">
                    <span class="w-1.5 h-1.5 rounded-full" :class="statusMeta(r.processing_status).dot" />
                    {{ statusMeta(r.processing_status).label }}
                  </span>
                </td>
                <td class="whitespace-normal break-words max-w-[200px] text-xs text-rose-500 dark:text-rose-400">{{ r.error_message || '—' }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(r)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!logs.length" message="暂无风控日志" icon="riskLogs" />
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
import { getRiskLogs, deleteRiskLog } from '~/api/admin'
import type { RiskLog } from '~/api/admin'

definePageMeta({ layout: 'default' })

const toast = useToast()

const STATUS_META: Record<string, { cls: string; dot: string; label: string }> = {
  processing: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', dot: 'bg-amber-500', label: '处理中' },
  success: { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', dot: 'bg-emerald-500', label: '成功' },
  failed: { cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300', dot: 'bg-rose-500', label: '失败' },
  manual: { cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300', dot: 'bg-sky-500', label: '需人工' },
}
function statusMeta(s: string) { return STATUS_META[s] || { cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300', dot: 'bg-slate-400', label: s || '未知' } }

const loading = ref(false)
const logs = ref<RiskLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filters = reactive({ cookie_id: '', status: '' })

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

async function reload() {
  loading.value = true
  try {
    const r = await getRiskLogs({
      page: page.value,
      pageSize: pageSize.value,
      cookie_id: filters.cookie_id.trim() || undefined,
      status: filters.status || undefined,
    })
    logs.value = r.data
    total.value = r.total
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

async function deleteOne(r: RiskLog) {
  if (!confirm('确认删除该风控日志？')) return
  try {
    await deleteRiskLog(r.id)
    toast.success('已删除')
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
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
