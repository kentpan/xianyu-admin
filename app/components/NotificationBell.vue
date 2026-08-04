<template>
  <div class="relative">
    <button
      class="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
      title="通知中心"
      @click="open = !open"
    >
      <Icon name="bell" />
      <span v-if="unread > 0" class="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-medium flex items-center justify-center">
        {{ unread > 9 ? '9+' : unread }}
      </span>
    </button>

    <!-- Dropdown panel -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="open" class="fixed inset-0 z-[85]" @click.self="open = false">
          <div class="absolute inset-0" @click="open = false" />
          <div
            class="modal-panel absolute right-3 top-14 w-[360px] max-w-[calc(100vw-24px)] bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <h3 class="font-semibold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <Icon name="bell" class="text-brand-500" /> 通知中心
                <span v-if="unread > 0" class="badge bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">{{ unread }} 未读</span>
              </h3>
              <div class="flex items-center gap-1">
                <button v-if="unread > 0" class="text-xs text-brand-600 hover:underline" @click="markAllRead">全部已读</button>
                <button class="p-1 text-slate-400 hover:text-slate-600" @click="seed">
                  <Icon name="refresh" class="text-xs" />
                </button>
              </div>
            </div>
            <!-- List -->
            <div class="max-h-[400px] overflow-y-auto scrollbar-thin">
              <div v-if="!items.length" class="py-10 text-center">
                <div class="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 mb-2">
                  <Icon name="bell" class="text-xl" />
                </div>
                <p class="text-sm text-slate-400">暂无通知</p>
              </div>
              <div v-for="n in items" :key="n.id" class="px-4 py-3 border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer" @click="handleClick(n)">
                <div class="flex items-start gap-2.5">
                  <span class="mt-0.5 w-2 h-2 rounded-full shrink-0" :class="dotClass(n.type)" />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      {{ n.title }}
                      <span v-if="!n.read" class="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                    </p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{{ n.message }}</p>
                    <p class="text-[10px] text-slate-400 mt-1">{{ formatTime(n.created_at) }}</p>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="items.length" class="px-4 py-2 border-t border-slate-100 dark:border-slate-700 text-center">
              <NuxtLink to="/admin/logs" class="text-xs text-brand-600 hover:underline" @click="open = false">查看系统日志 →</NuxtLink>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'
import { useToast } from '~/composables/useToast'

const api = useApi()
const toast = useToast()
const router = useRouter()

interface NotifItem {
  id: number
  type: string
  title: string
  message: string
  read: number
  link: string | null
  created_at: string
}

const open = ref(false)
const items = ref<NotifItem[]>([])
const unread = ref(0)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await api.get<{ items: NotifItem[]; unread: number }>('/api/notifications/center')
    items.value = data.items || []
    unread.value = data.unread || 0
  } catch {
    // silent
  } finally {
    loading.value = false
  }
}

async function markAllRead() {
  try {
    await api.post('/api/notifications/center/read', { all: true })
    items.value = items.value.map((i) => ({ ...i, read: 1 }))
    unread.value = 0
    toast.success('已全部标记为已读')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function seed() {
  try {
    await api.post('/api/notifications/center/seed')
    toast.success('已生成演示通知')
    await load()
  } catch (e: any) {
    toast.error(e.message || '生成失败')
  }
}

function handleClick(n: NotifItem) {
  if (!n.read) {
    api.post('/api/notifications/center/read', { id: n.id }).catch(() => {})
    n.read = 1
    unread.value = Math.max(0, unread.value - 1)
  }
  if (n.link) {
    open.value = false
    router.push(n.link)
  }
}

function dotClass(type: string) {
  return {
    success: 'bg-emerald-500',
    info: 'bg-sky-500',
    warning: 'bg-amber-500',
    error: 'bg-rose-500',
  }[type] || 'bg-slate-400'
}

function formatTime(t?: string) {
  if (!t) return ''
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  load()
  // Poll every 60s
  if (import.meta.client) {
    const t = setInterval(load, 60000)
    onBeforeUnmount(() => clearInterval(t))
  }
})
</script>
