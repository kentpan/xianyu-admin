<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="消息通知" description="按账号 × 渠道矩阵管理通知开关">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <div v-if="loading" class="card p-10 flex items-center justify-center text-slate-400">
      <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
    </div>

    <template v-else>
      <div v-if="!channels.length" class="card p-5 flex items-start gap-3 border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-900/30">
        <Icon name="alert" class="text-amber-500 mt-0.5" />
        <div class="text-sm text-amber-700 dark:text-amber-300">
          尚未配置任何通知渠道，请先到 <NuxtLink to="/notification-channels" class="font-medium underline">通知渠道</NuxtLink> 添加。
        </div>
      </div>

      <div v-if="!accounts.length" class="card p-5 flex items-start gap-3 border-sky-200 bg-sky-50 dark:bg-sky-900/10 dark:border-sky-900/30">
        <Icon name="info" class="text-sky-500 mt-0.5" />
        <div class="text-sm text-sky-700 dark:text-sky-300">
          还没有闲鱼账号，请先到 <NuxtLink to="/accounts" class="font-medium underline">账号管理</NuxtLink> 添加。
        </div>
      </div>

      <!-- Matrix -->
      <div v-if="accounts.length && channels.length" class="card overflow-hidden">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="sticky left-0 bg-slate-50 dark:bg-slate-800/80 z-10">账号</th>
                <th v-for="ch in channels" :key="ch.id" class="text-center min-w-[110px]">
                  <div class="flex flex-col items-center gap-1">
                    <span class="badge" :class="typeMeta(ch.type).cls">
                      <Icon :name="typeMeta(ch.type).icon" /> {{ typeMeta(ch.type).label }}
                    </span>
                    <span class="text-xs font-normal text-slate-600 dark:text-slate-300 truncate max-w-[100px]">{{ ch.name }}</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="acc in accounts" :key="acc.id">
                <td class="sticky left-0 bg-white dark:bg-slate-800/60 z-10">
                  <div class="font-medium text-slate-800 dark:text-white truncate max-w-[200px]">{{ acc.remark || acc.id }}</div>
                  <div class="text-xs text-slate-400 font-mono truncate max-w-[200px]">{{ acc.id }}</div>
                </td>
                <td v-for="ch in channels" :key="ch.id" class="text-center">
                  <button
                    class="inline-flex items-center justify-center w-10 h-6 rounded-full transition-colors"
                    :class="matrixKey(acc.id, ch.id) ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-700'"
                    :disabled="toggling.has(matrixTogKey(acc.id, ch.id))"
                    :title="matrixKey(acc.id, ch.id) ? '已启用，点击关闭' : '点击启用'"
                    @click="toggle(acc.id, ch.id)"
                  >
                    <span
                      class="w-5 h-5 rounded-full bg-white shadow transform transition-transform"
                      :class="matrixKey(acc.id, ch.id) ? 'translate-x-4' : 'translate-x-0.5'"
                    />
                  </button>
                  <Icon v-if="toggling.has(matrixTogKey(acc.id, ch.id))" name="refresh" class="animate-spin text-xs text-slate-400 mt-1 inline-block" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <EmptyState v-if="!accounts.length && !channels.length" message="请先添加账号与通知渠道" icon="msgNotify" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

interface AccountLite { id: string; remark: string }
interface ChannelLite { id: number; name: string; type: string; enabled: number }
interface MessageNotification { id: number; cookie_id: string; channel_id: number; enabled: number }

const CHANNEL_TYPE_META: Record<string, { label: string; icon: string; cls: string }> = {
  qq: { label: 'QQ', icon: 'message', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  dingtalk: { label: '钉钉', icon: 'bell', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  ding_talk: { label: '钉钉', icon: 'bell', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  feishu: { label: '飞书', icon: 'bell', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  lark: { label: '飞书', icon: 'bell', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  bark: { label: 'Bark', icon: 'bell', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  email: { label: '邮件', icon: 'message', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  webhook: { label: 'Webhook', icon: 'external', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200' },
  wechat: { label: '企微', icon: 'bell', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  telegram: { label: 'TG', icon: 'arrowRight', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
}
function typeMeta(t: string) { return CHANNEL_TYPE_META[t] || { label: t, icon: 'bell', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200' } }

const loading = ref(false)
const accounts = ref<AccountLite[]>([])
const channels = ref<ChannelLite[]>([])
const enabledMap = ref<Set<string>>(new Set()) // key: `${cookie_id}|${channel_id}`
const toggling = ref<Set<string>>(new Set())

function matrixKey(cookieId: string, channelId: number): boolean {
  return enabledMap.value.has(`${cookieId}|${channelId}`)
}
function matrixTogKey(cookieId: string, channelId: number) { return `${cookieId}|${channelId}` }

async function reload() {
  loading.value = true
  try {
    const [accs, chs, mns] = await Promise.all([
      api.get<AccountLite[]>('/api/accounts'),
      api.get<ChannelLite[]>('/api/notifications/channels'),
      api.get<MessageNotification[]>('/api/notifications/messages'),
    ])
    accounts.value = accs
    channels.value = chs.filter((c) => c.enabled)
    const next = new Set<string>()
    for (const m of mns) {
      if (m.enabled) next.add(`${m.cookie_id}|${m.channel_id}`)
    }
    enabledMap.value = next
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function toggle(cookieId: string, channelId: number) {
  const key = matrixTogKey(cookieId, channelId)
  const next = !matrixKey(cookieId, channelId)
  toggling.value.add(key)
  try {
    await api.post(`/api/notifications/messages/${encodeURIComponent(cookieId)}`, {
      channel_id: channelId,
      enabled: next,
    })
    const set = new Set(enabledMap.value)
    if (next) set.add(key); else set.delete(key)
    enabledMap.value = set
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  } finally {
    toggling.value.delete(key)
  }
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
