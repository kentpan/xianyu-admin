<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="操作审计日志" description="记录所有用户的关键操作，便于追溯">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label class="label">操作类型</label>
          <select v-model="filters.action" class="input" @change="reload">
            <option value="">全部</option>
            <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
          </select>
        </div>
        <div>
          <label class="label">模块</label>
          <select v-model="filters.module" class="input" @change="reload">
            <option value="">全部</option>
            <option v-for="m in modules" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="label">关键词搜索</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input v-model="filters.keyword" class="input pl-9" placeholder="描述 / 用户名 / 目标ID" @keyup.enter="reload" />
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
                <th>时间</th>
                <th>用户</th>
                <th>操作</th>
                <th>模块</th>
                <th>目标</th>
                <th>描述</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id">
                <td class="text-slate-500 dark:text-slate-400 whitespace-nowrap">{{ formatTime(log.created_at) }}</td>
                <td class="font-medium text-slate-800 dark:text-slate-100">{{ log.username || '—' }}</td>
                <td><span class="badge" :class="actionClass(log.action)">{{ log.action }}</span></td>
                <td class="text-slate-600 dark:text-slate-300">{{ log.module || '—' }}</td>
                <td class="font-mono text-xs text-slate-500">
                  <span v-if="log.target_type">{{ log.target_type }}: {{ log.target_id }}</span>
                  <span v-else>—</span>
                </td>
                <td class="max-w-[300px] truncate text-slate-600 dark:text-slate-300">{{ log.description || '—' }}</td>
                <td class="font-mono text-xs text-slate-400">{{ log.ip_address || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!logs.length" message="暂无审计日志" icon="logs" />
        <!-- Pagination -->
        <div v-if="total > pageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
          <span class="text-xs text-slate-400">共 {{ total }} 条，第 {{ page }}/{{ totalPages }} 页</span>
          <div class="flex items-center gap-1">
            <button class="btn-ghost !px-2 !py-1 !text-xs" :disabled="page <= 1" @click="page--; reload()">上一页</button>
            <button class="btn-ghost !px-2 !py-1 !text-xs" :disabled="page >= totalPages" @click="page++; reload()">下一页</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getAuditLogs } from '~/api/audit'
import type { AuditLog } from '~/api/audit'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const logs = ref<AuditLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const actions = ref<string[]>([])
const modules = ref<string[]>([])
const filters = reactive({ action: '', module: '', keyword: '' })

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

async function reload() {
  loading.value = true
  try {
    const r = await getAuditLogs({
      page: page.value,
      pageSize: pageSize.value,
      action: filters.action || undefined,
      module: filters.module || undefined,
      keyword: filters.keyword.trim() || undefined,
    })
    logs.value = r.data || []
    total.value = r.total || 0
    actions.value = r.actions || []
    modules.value = r.modules || []
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function actionClass(action: string) {
  const a = action.toLowerCase()
  if (a.includes('create') || a.includes('add') || a.includes('新增')) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (a.includes('update') || a.includes('edit') || a.includes('put') || a.includes('修改')) return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
  if (a.includes('delete') || a.includes('remove') || a.includes('删除')) return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
  if (a.includes('login') || a.includes('logout') || a.includes('登录') || a.includes('退出')) return 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
  if (a.includes('import') || a.includes('export') || a.includes('导入') || a.includes('导出')) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  return 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300'
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
