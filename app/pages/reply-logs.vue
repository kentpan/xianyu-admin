<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="回复决策日志" description="监听引擎对每条买家消息的处理记录：命中策略、关键词、回复内容与发送结果，可用于排查「为什么没回」">
      <template #actions>
        <button class="btn-secondary" @click="load">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <label class="text-sm text-slate-500 dark:text-slate-400">账号</label>
          <select v-model="filterCookieId" class="input !w-auto min-w-[180px]" @change="load">
            <option value="">全部账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-sm text-slate-500 dark:text-slate-400">策略</label>
          <select v-model="filterStrategy" class="input !w-auto min-w-[140px]" @change="load">
            <option value="">全部策略</option>
            <option value="keyword">关键词回复</option>
            <option value="ai">AI 回复</option>
            <option value="default">默认回复</option>
            <option value="api">API 回复</option>
            <option value="none">未回复</option>
          </select>
        </div>
        <div class="relative flex-1 min-w-[220px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="filterKeyword" class="input pl-9" placeholder="搜索消息 / 关键词 / 回复内容 / 买家" @keyup.enter="load" />
        </div>
        <p class="text-xs text-slate-400">共 {{ total }} 条</p>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <div v-else-if="!logs.length" class="p-10 text-center text-slate-400">
        暂无日志 — 引擎启动并收到买家消息后，这里会记录每条消息的回复决策。
      </div>
      <template v-else>
        <div class="table-wrap max-h-[65vh] overflow-y-auto">
          <table class="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>账号</th>
                <th>买家 / 消息</th>
                <th>策略</th>
                <th>命中关键词</th>
                <th>回复内容</th>
                <th>发送状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id">
                <td class="whitespace-nowrap text-slate-500 dark:text-slate-400">{{ formatTime(log.created_at) }}</td>
                <td class="text-slate-500 dark:text-slate-400">{{ log.cookie_id }}</td>
                <td class="max-w-[260px]">
                  <p class="font-medium text-slate-900 dark:text-white truncate">{{ log.sender_user_name || log.sender_user_id || '-' }}</p>
                  <p class="text-slate-500 dark:text-slate-400 truncate">{{ log.source_message || '-' }}</p>
                </td>
                <td>
                  <span class="badge" :class="strategyMeta(log).cls">{{ strategyMeta(log).label }}</span>
                </td>
                <td class="max-w-[140px] truncate text-slate-500 dark:text-slate-400">{{ log.matched_keyword || '-' }}</td>
                <td class="max-w-[260px]">
                  <p class="truncate" :class="log.error_message ? 'text-rose-500' : 'text-slate-700 dark:text-slate-300'">
                    {{ log.error_message || log.reply_text || '-' }}
                  </p>
                </td>
                <td>
                  <span class="badge" :class="sendMeta(log.send_status).cls">{{ sendMeta(log.send_status).label }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="logs.length < total" class="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-center">
          <button class="btn-secondary" :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? '加载中...' : `加载更多 (剩余 ${total - logs.length} 条)` }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getReplyLogs, type ReplyLog } from '~/api/reply-logs'
import { getAccounts, type AccountLite } from '~/api/accounts'
import { useToast } from '~/composables/useToast'

const toast = useToast()
const logs = ref<ReplyLog[]>([])
const accounts = ref<AccountLite[]>([])
const total = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const filterCookieId = ref('')
const filterStrategy = ref('')
const filterKeyword = ref('')

async function load() {
  loading.value = true
  try {
    const res = await getReplyLogs({
      cookie_id: filterCookieId.value || undefined,
      strategy: filterStrategy.value || undefined,
      keyword: filterKeyword.value || undefined,
      limit: 100,
    })
    logs.value = res.logs
    total.value = res.total
  } catch (e: any) {
    toast.error(e?.message || '获取日志失败')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  try {
    const res = await getReplyLogs({
      cookie_id: filterCookieId.value || undefined,
      strategy: filterStrategy.value || undefined,
      keyword: filterKeyword.value || undefined,
      limit: 100,
      offset: logs.value.length,
    })
    logs.value = logs.value.concat(res.logs)
  } catch (e: any) {
    toast.error(e?.message || '加载更多失败')
  } finally {
    loadingMore.value = false
  }
}

function strategyMeta(log: ReplyLog) {
  if (log.process_status === 'skipped') {
    switch (log.decision_reason) {
      case 'manual_reply_pause': return { label: '手动回复暂停', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' }
      case 'reply_cooldown': return { label: '冷却跳过', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
      case 'system_notice': return { label: '系统通知', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
      case 'skip_reply_filter': return { label: '过滤规则', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
      default: return { label: '跳过', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
    }
  }
  switch (log.reply_strategy) {
    case 'keyword': return { label: '关键词', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' }
    case 'ai': return { label: 'AI', cls: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400' }
    case 'default': return { label: '默认回复', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' }
    case 'api': return { label: 'API', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400' }
    default: return { label: '未回复', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
  }
}

function sendMeta(sendStatus: string) {
  switch (sendStatus) {
    case 'success': return { label: '已发送', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' }
    case 'failed': return { label: '发送失败', cls: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' }
    default: return { label: '未发送', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
  }
}

function formatTime(t: string) {
  if (!t) return '-'
  try {
    const d = t.includes('T') || t.includes('Z') ? new Date(t) : new Date(t.replace(' ', 'T') + 'Z')
    if (Number.isNaN(d.getTime())) return t
    return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return t
  }
}

onMounted(async () => {
  try {
    accounts.value = await getAccounts()
  } catch { /* 账号加载失败不阻塞日志展示 */ }
  await load()
})
</script>
