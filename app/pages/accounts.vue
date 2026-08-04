<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="账号管理" description="维护闲鱼账号 Cookie 与启停、自动确认、暂停时长等">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 新增账号
        </button>
      </template>
    </PageHeader>

    <!-- Health overview -->
    <div v-if="healthData.length" class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <Icon name="activity" class="text-brand-500" />
          <h3 class="font-semibold text-slate-900 dark:text-white">账号健康度</h3>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400">平均健康分</span>
          <span class="text-2xl font-bold tabular-nums" :class="healthScoreClass(healthSummary.avgScore)">{{ healthSummary.avgScore }}</span>
          <span class="text-xs text-slate-400">/100</span>
        </div>
      </div>
      <!-- Health stats row -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-center">
          <p class="text-xs text-slate-400">总账号</p>
          <p class="text-lg font-semibold text-slate-900 dark:text-white tabular-nums">{{ healthSummary.total }}</p>
        </div>
        <div class="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
          <p class="text-xs text-emerald-600 dark:text-emerald-400">健康</p>
          <p class="text-lg font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{{ healthSummary.good }}</p>
        </div>
        <div class="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-center">
          <p class="text-xs text-amber-600 dark:text-amber-400">一般</p>
          <p class="text-lg font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{{ healthSummary.fair }}</p>
        </div>
        <div class="rounded-lg bg-rose-50 dark:bg-rose-900/20 p-3 text-center">
          <p class="text-xs text-rose-600 dark:text-rose-400">较差</p>
          <p class="text-lg font-semibold text-rose-600 dark:text-rose-400 tabular-nums">{{ healthSummary.poor }}</p>
        </div>
        <div class="rounded-lg bg-sky-50 dark:bg-sky-900/20 p-3 text-center">
          <p class="text-xs text-sky-600 dark:text-sky-400">关键词/订单</p>
          <p class="text-lg font-semibold text-sky-600 dark:text-sky-400 tabular-nums">{{ healthSummary.totalKeywords }}/{{ healthSummary.totalOrders }}</p>
        </div>
      </div>
      <!-- Per-account health bars -->
      <div class="space-y-2.5">
        <div v-for="h in healthData" :key="h.id" class="flex items-center gap-3">
          <span class="w-24 text-sm text-slate-600 dark:text-slate-300 truncate shrink-0" :title="h.remark">{{ h.remark }}</span>
          <div class="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500" :class="healthBarClass(h.healthLevel)" :style="{ width: h.healthScore + '%' }" />
          </div>
          <span class="w-8 text-right text-sm font-medium tabular-nums" :class="healthScoreClass(h.healthScore)">{{ h.healthScore }}</span>
          <div class="hidden sm:flex items-center gap-1.5 shrink-0">
            <span v-if="h.aiEnabled" class="badge bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300 text-[10px]">AI</span>
            <span v-if="h.enabled" class="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px]">启用</span>
            <span v-else class="badge bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 text-[10px]">停用</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Search -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" />
          </span>
          <input
            v-model="keyword"
            class="input pl-9"
            placeholder="搜索账号 ID / 备注"
          />
        </div>
        <p class="text-xs text-slate-400">共 {{ filtered.length }} 个账号</p>
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
                <th>账号 ID</th>
                <th>备注</th>
                <th>状态</th>
                <th>自动确认</th>
                <th>暂停时长</th>
                <th>关键词</th>
                <th>创建时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in filtered" :key="a.id">
                <td>
                  <button class="text-slate-800 dark:text-white font-medium hover:text-brand-600" @click="openEdit(a)">
                    {{ a.id }}
                  </button>
                  <p class="text-xs text-slate-400 mt-0.5 font-mono truncate max-w-[180px]">{{ a.value_preview }}…</p>
                </td>
                <td>
                  <span v-if="a.remark" class="text-slate-700 dark:text-slate-200">{{ a.remark }}</span>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td>
                  <span class="badge" :class="a.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'">
                    <span class="w-1.5 h-1.5 rounded-full" :class="a.enabled ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ a.enabled ? '运行中' : '已停用' }}
                  </span>
                </td>
                <td>
                  <button
                    class="badge transition-colors"
                    :class="a.auto_confirm ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'"
                    :title="a.auto_confirm ? '点击关闭' : '点击开启'"
                    @click="toggleAutoConfirm(a)"
                  >
                    <Icon name="check" v-if="a.auto_confirm" />
                    {{ a.auto_confirm ? '已开启' : '已关闭' }}
                  </button>
                </td>
                <td>{{ a.pause_duration }}s</td>
                <td>
                  <NuxtLink :to="`/keywords?cookie_id=${encodeURIComponent(a.id)}`" class="text-sky-600 hover:underline">
                    {{ a.keyword_count }} 条
                  </NuxtLink>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(a.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(a)">
                      <Icon name="edit" />
                    </button>
                    <button
                      class="btn-ghost !px-2 !py-1"
                      :title="a.enabled ? '停用' : '启用'"
                      @click="toggleEnabled(a)"
                    >
                      <Icon :name="a.enabled ? 'eyeOff' : 'eye'" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="confirmDelete(a)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!filtered.length" message="还没有账号，点击右上角「新增账号」开始" icon="accounts" />
      </template>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑账号' : '新增账号'" size="lg">
      <div class="space-y-4">
        <div>
          <label class="label">账号 ID <span class="text-slate-400 text-xs">(留空自动生成)</span></label>
          <input v-model="form.id" class="input" placeholder="acc_xxx 或留空自动生成" :disabled="editing" />
        </div>
        <div>
          <label class="label">Cookie 内容 <span class="text-red-500">*</span></label>
          <textarea v-model="form.value" rows="4" class="input font-mono text-xs" placeholder="粘贴完整 Cookie 字符串" />
        </div>
        <div>
          <label class="label">备注</label>
          <input v-model="form.remark" class="input" placeholder="便于识别的备注名" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">暂停时长 (秒)</label>
            <input v-model.number="form.pause_duration" type="number" min="0" class="input" />
          </div>
          <div class="flex items-end pb-1">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="form.auto_confirm" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
              <span class="text-sm text-slate-700 dark:text-slate-200">自动确认收货</span>
            </label>
          </div>
        </div>
        <template v-if="editing">
          <div class="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-4">
            <div>
              <label class="label">闲鱼用户名</label>
              <input v-model="form.username" class="input" placeholder="可选" />
            </div>
            <div>
              <label class="label">闲鱼密码</label>
              <input v-model="form.password" type="password" class="input" placeholder="可选，加密存储" />
            </div>
            <div class="flex items-center gap-2">
              <input v-model="form.show_browser" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
              <span class="text-sm text-slate-700 dark:text-slate-200">显示浏览器窗口 (调试用)</span>
            </div>
          </div>
        </template>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">取消</button>
        <button class="btn-primary" :disabled="saving" @click="saveAccount">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除账号" size="sm" :close-on-backdrop="true" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-sm text-slate-500 mt-2">
          确认删除账号 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.remark || deleteTarget?.id }}</span>？
          相关关键词、AI 设置、回复模板等将一并删除，订单与商品记录会保留。
        </p>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="deleteTarget = null">取消</button>
        <button class="btn-danger flex-1" :disabled="deleting" @click="doDelete">
          <Icon name="refresh" v-if="deleting" class="animate-spin" />
          确认删除
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

interface Account {
  id: string
  value_preview: string
  auto_confirm: number
  remark: string
  pause_duration: number
  username: string
  created_at: string
  enabled: number
  keyword_count: number
}

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const accounts = ref<Account[]>([])
const keyword = ref('')
const modalOpen = ref(false)
const editing = ref(false)
const deleteTarget = ref<Account | null>(null)

interface AccountHealth {
  id: string
  remark: string
  enabled: boolean
  autoConfirm: boolean
  keywordCount: number
  orderCount: number
  lastOrderAt: string | null
  aiEnabled: boolean
  healthScore: number
  healthLevel: 'good' | 'fair' | 'poor'
}
const healthData = ref<AccountHealth[]>([])

const healthSummary = computed(() => {
  const total = healthData.value.length
  if (!total) return { total: 0, good: 0, fair: 0, poor: 0, avgScore: 0, totalKeywords: 0, totalOrders: 0 }
  const good = healthData.value.filter((h) => h.healthLevel === 'good').length
  const fair = healthData.value.filter((h) => h.healthLevel === 'fair').length
  const poor = healthData.value.filter((h) => h.healthLevel === 'poor').length
  const avgScore = Math.round(healthData.value.reduce((s, h) => s + h.healthScore, 0) / total)
  const totalKeywords = healthData.value.reduce((s, h) => s + h.keywordCount, 0)
  const totalOrders = healthData.value.reduce((s, h) => s + h.orderCount, 0)
  return { total, good, fair, poor, avgScore, totalKeywords, totalOrders }
})

const form = ref<any>({
  id: '',
  value: '',
  remark: '',
  pause_duration: 10,
  auto_confirm: true,
  username: '',
  password: '',
  show_browser: false,
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return accounts.value
  return accounts.value.filter(
    (a) => a.id.toLowerCase().includes(k) || (a.remark || '').toLowerCase().includes(k),
  )
})

async function reload() {
  loading.value = true
  try {
    const [accs, health] = await Promise.all([
      api.get<Account[]>('/api/accounts'),
      api.get<AccountHealth[]>('/api/accounts/health').catch(() => []),
    ])
    accounts.value = accs
    healthData.value = health
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  form.value = { id: '', value: '', remark: '', pause_duration: 10, auto_confirm: true, username: '', password: '', show_browser: false }
  modalOpen.value = true
}

function openEdit(a: Account) {
  editing.value = true
  api.get<any>(`/api/accounts/${encodeURIComponent(a.id)}`).then((d) => {
    const c = d.cookie
    form.value = {
      id: c.id,
      value: c.value || '',
      remark: c.remark || '',
      pause_duration: Number(c.pause_duration ?? 10),
      auto_confirm: !!c.auto_confirm,
      username: c.username || '',
      password: c.password || '',
      show_browser: !!c.show_browser,
    }
    modalOpen.value = true
  }).catch((e) => toast.error(e.message || '加载详情失败'))
}

function closeModal() {
  modalOpen.value = false
}

async function saveAccount() {
  if (!form.value.value.trim()) {
    toast.error('Cookie 内容不能为空')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await api.put(`/api/accounts/${encodeURIComponent(form.value.id)}`, {
        value: form.value.value,
        remark: form.value.remark,
        pause_duration: form.value.pause_duration,
        auto_confirm: form.value.auto_confirm,
        username: form.value.username,
        password: form.value.password,
        show_browser: form.value.show_browser,
      })
      toast.success('账号已更新')
    } else {
      await api.post('/api/accounts', {
        id: form.value.id || undefined,
        value: form.value.value,
        remark: form.value.remark,
        pause_duration: form.value.pause_duration,
        auto_confirm: form.value.auto_confirm,
      })
      toast.success('账号已添加')
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(a: Account) {
  try {
    const r = await api.put<{ enabled: number }>(`/api/accounts/${encodeURIComponent(a.id)}/status`, {
      enabled: !a.enabled,
    })
    a.enabled = r.enabled
    toast.success(r.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function toggleAutoConfirm(a: Account) {
  try {
    const r = await api.put<{ auto_confirm: number }>(`/api/accounts/${encodeURIComponent(a.id)}/auto-confirm`, {
      auto_confirm: !a.auto_confirm,
    })
    a.auto_confirm = r.auto_confirm
    toast.success('已更新自动确认设置')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function confirmDelete(a: Account) {
  deleteTarget.value = a
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api.del(`/api/accounts/${encodeURIComponent(deleteTarget.value.id)}`)
    toast.success('账号已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(t.replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function healthScoreClass(score: number) {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}
function healthBarClass(level: string) {
  if (level === 'good') return 'bg-emerald-500'
  if (level === 'fair') return 'bg-amber-500'
  return 'bg-rose-500'
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
