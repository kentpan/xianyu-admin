<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="闲鱼消息管理" description="IM 会话/消息实时落库 (引擎监听源头采集) + SSE 实时推送，可手动回复买家">
      <template #actions>
        <button class="btn-secondary" @click="reload" :disabled="loading">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" :disabled="syncing || !filterCookieId" @click="syncConversations" title="从闲鱼平台拉取最新会话列表 (WS 协议)">
          <Icon name="download" :class="syncing ? 'animate-spin' : ''" /> 同步平台会话
        </button>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
      <!-- 会话列表 -->
      <div class="card flex flex-col" :class="activeConv ? 'hidden lg:flex' : 'flex'">
        <div class="p-4 space-y-3 border-b border-slate-100 dark:border-slate-800">
          <select v-model="filterCookieId" class="input">
            <option value="">全部账号</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.remark || a.id }}</option>
          </select>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
            <input v-model="keyword" class="input pl-9" placeholder="搜索昵称 / 消息 / 商品" />
          </div>
        </div>
        <div class="overflow-y-auto max-h-[560px]">
          <div v-if="loading && !convs.length" class="p-8 flex items-center justify-center text-slate-400">
            <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
          </div>
          <button
            v-for="c in convs"
            :key="c.cookie_id + ':' + c.chat_id"
            class="w-full text-left px-4 py-3 border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
            :class="isActive(c) ? 'bg-brand-50 dark:bg-brand-900/20' : ''"
            @click="openConv(c)"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="font-medium text-slate-800 dark:text-slate-100 truncate">{{ c.peer_nick || c.peer_user_id || c.chat_id }}</p>
              <span class="shrink-0 text-slate-400">{{ shortTime(c.last_message_time) }}</span>
            </div>
            <div class="flex items-center justify-between gap-2 mt-1">
              <p class="truncate text-slate-500 dark:text-slate-400">{{ c.last_message || '—' }}</p>
              <span v-if="c.unread" class="shrink-0 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center">{{ c.unread > 99 ? '99+' : c.unread }}</span>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-slate-400">{{ c.cookie_remark || c.cookie_id }}</span>
              <span v-if="c.item_title" class="truncate text-slate-400">· {{ c.item_title }}</span>
            </div>
          </button>
          <EmptyState v-if="!loading && !convs.length" message="暂无会话；引擎监听到买家消息后自动落库，也可点「同步平台会话」拉取" icon="message" />
        </div>
      </div>

      <!-- 聊天面板 -->
      <div class="card flex flex-col" :class="activeConv ? 'flex' : 'hidden lg:flex'">
        <template v-if="activeConv">
          <div class="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800">
            <button class="btn-ghost !px-2 !py-1 lg:hidden" @click="activeConv = null"><Icon name="chevronRight" class="rotate-180" /></button>
            <div class="min-w-0 flex-1">
              <p class="font-medium text-slate-900 dark:text-white truncate">{{ activeConv.peer_nick || activeConv.peer_user_id || activeConv.chat_id }}</p>
              <p class="text-slate-400 truncate">会话 {{ activeConv.chat_id }}<template v-if="activeConv.item_title"> · {{ activeConv.item_title }}</template></p>
            </div>
            <span class="badge" :class="liveConnected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'">
              <span class="w-1.5 h-1.5 rounded-full" :class="liveConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'" />
              {{ liveConnected ? '实时' : '离线' }}
            </span>
          </div>

          <div ref="chatBox" class="flex-1 overflow-y-auto p-4 space-y-3 max-h-[460px] min-h-[320px]">
            <div v-if="msgLoading" class="p-6 flex items-center justify-center text-slate-400">
              <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
            </div>
            <template v-else>
              <div v-for="m in msgs" :key="m.id" class="flex" :class="m.direction === 'out' ? 'justify-end' : 'justify-start'">
                <div
                  class="max-w-[75%] rounded-2xl px-4 py-2"
                  :class="m.direction === 'out'
                    ? 'bg-brand-500 text-white rounded-br-sm'
                    : m.direction === 'system'
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-sm'"
                >
                  <p v-if="m.direction === 'system'" class="text-center">{{ m.content }}<template v-if="m.amount"> · ¥{{ m.amount }}</template></p>
                  <template v-else>
                    <p v-if="m.content_type === 'image'" class="break-all">{{ m.content }}</p>
                    <p v-else class="whitespace-pre-wrap break-words">{{ m.content }}</p>
                  </template>
                  <p class="mt-1 opacity-60" :class="m.direction === 'out' ? 'text-right' : ''">{{ shortTime(m.msg_time) }}</p>
                </div>
              </div>
              <EmptyState v-if="!msgs.length" message="该会话暂无落库消息" icon="message" />
            </template>
          </div>

          <div class="p-4 border-t border-slate-100 dark:border-slate-800">
            <div class="flex gap-2">
              <input
                v-model="draft"
                class="input flex-1"
                placeholder="输入回复消息，回车发送"
                :disabled="sending"
                @keyup.enter="doSend"
              />
              <button class="btn-primary shrink-0" :disabled="sending || !draft.trim()" @click="doSend">
                <Icon name="arrowRight" /> 发送
              </button>
            </div>
            <p class="mt-2 text-slate-400">发送走账号监听通道（人化节拍），账号需为「内置引擎」托管且在线</p>
          </div>
        </template>
        <template v-else>
          <div class="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <Icon name="message" class="text-slate-300 dark:text-slate-600 mb-3" />
            <p class="text-slate-500 dark:text-slate-400">从左侧选择会话查看消息并回复</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getConversations, getMessages, sendMessage, syncConversations } from '~/api/messages'
import type { ImConversation, ImMessage } from '~/api/messages'
import { getAccounts } from '~/api/accounts'
import type { AccountLite } from '~/api/accounts'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const syncing = ref(false)
const msgLoading = ref(false)
const sending = ref(false)
const convs = ref<ImConversation[]>([])
const accounts = ref<AccountLite[]>([])
const filterCookieId = ref('')
const keyword = ref('')
const activeConv = ref<ImConversation | null>(null)
const msgs = ref<ImMessage[]>([])
const draft = ref('')
const liveConnected = ref(false)
const chatBox = ref<HTMLElement | null>(null)


function isActive(c: ImConversation) {
  return activeConv.value?.cookie_id === c.cookie_id && activeConv.value?.chat_id === c.chat_id
}

function shortTime(t?: string | null) {
  if (!t) return ''
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return String(t)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function reload() {
  loading.value = true
  try {
    const [convData, accountData] = await Promise.all([
      getConversations(filterCookieId.value || undefined, keyword.value.trim() || undefined),
      getAccounts().catch(() => [] as AccountLite[]),
    ])
    convs.value = convData
    accounts.value = accountData
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function openConv(c: ImConversation) {
  activeConv.value = c
  await loadMessages()
}

async function loadMessages() {
  if (!activeConv.value) return
  msgLoading.value = true
  try {
    msgs.value = await getMessages(activeConv.value.cookie_id, activeConv.value.chat_id)
    await nextTick()
    scrollBottom()
  } catch (e: any) {
    toast.error(e.message || '消息加载失败')
  } finally {
    msgLoading.value = false
  }
}

function scrollBottom() {
  if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight
}

async function doSend() {
  const c = activeConv.value
  if (!c || !draft.value.trim()) return
  sending.value = true
  try {
    await sendMessage(c.cookie_id, c.chat_id, draft.value.trim())
    draft.value = ''
    await loadMessages()
  } catch (e: any) {
    toast.error(e.message || '发送失败')
  } finally {
    sending.value = false
  }
}

async function syncConversations() {
  if (!filterCookieId.value) {
    toast.error('请先在左侧选择要同步的账号')
    return
  }
  syncing.value = true
  try {
    const r = await syncConversations(filterCookieId.value)
    toast.success(r.fetched ? `拉取 ${r.fetched} 个会话, 落库 ${r.stored} 条` : '平台未返回会话')
    reload()
  } catch (e: any) {
    toast.error(e.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

/** 实时推送: edge 走 Durable Object WebSocket, node 走 SSE (useRealtime 自动选择, 零轮询) */
const realtime = useRealtime()
watch(realtime.status, (s) => (liveConnected.value = s === 'open'))
realtime.on((d) => {
  if (!d.cookie_id) return
  const sameConv = activeConv.value && d.chat_id === activeConv.value.chat_id && d.cookie_id === activeConv.value.cookie_id
  if (sameConv && (d.type === 'chat' || d.type === 'sent') && d.message) {
    msgs.value.push({ id: Date.now(), direction: d.type === 'sent' ? 'out' : 'in', ...d.message })
    nextTick(scrollBottom)
  }
  // 轻量刷新会话摘要 (避免每事件全量拉取: 800ms 合并窗口)
  scheduleConvRefresh()
})

let refreshTimer: ReturnType<typeof setTimeout> | null = null
function scheduleConvRefresh() {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    getConversations(filterCookieId.value || undefined, keyword.value.trim() || undefined)
      .then((rows) => (convs.value = rows))
      .catch(() => {})
  }, 800)
}

onMounted(() => {
  reload()
  realtime.connect()
})
onBeforeUnmount(() => {
  realtime.disconnect()
  if (refreshTimer) clearTimeout(refreshTimer)
})
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
