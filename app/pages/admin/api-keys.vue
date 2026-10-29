<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="API Key 管理" description="为远程调用卡密核销接口的业务方分发独立 Key: 可配置限速, 明文可反复查看复制, 内置调用统计报表">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-primary" @click="openCreate">
          <Icon name="plus" /> 生成新 Key
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[220px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input v-model="keyword" class="input pl-9" placeholder="搜索业务方名称 / Key / 备注" @keyup.enter="resetAndReload" />
        </div>
        <select v-model="enabledFilter" class="input !w-auto min-w-[140px]" @change="resetAndReload">
          <option value="">全部状态</option>
          <option value="1">已启用</option>
          <option value="0">已停用</option>
        </select>
        <p class="text-slate-400">共 {{ total }} 个 Key</p>
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
                <th>业务方</th>
                <th>API Key</th>
                <th>限速</th>
                <th>有效期</th>
                <th>调用统计</th>
                <th>状态</th>
                <th>最近使用</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in keys" :key="k.id">
                <td>
                  <p class="font-medium text-slate-800 dark:text-slate-100">{{ k.name }}</p>
                  <p v-if="k.remark" class="text-slate-400 mt-0.5 truncate max-w-[180px]" :title="k.remark">{{ k.remark }}</p>
                </td>
                <td>
                  <div class="flex items-center gap-1">
                    <code class="font-mono text-slate-600 dark:text-slate-300 max-w-[220px] truncate" :title="k.api_key">
                      {{ visibleKeyId === k.id ? k.api_key : maskKey(k.api_key) }}
                    </code>
                    <button class="btn-ghost !px-1.5 !py-1" :title="visibleKeyId === k.id ? '隐藏' : '显示'" @click="visibleKeyId = visibleKeyId === k.id ? 0 : k.id">
                      <Icon :name="visibleKeyId === k.id ? 'eyeOff' : 'eye'" />
                    </button>
                    <button class="btn-ghost !px-1.5 !py-1" title="复制" @click="copyText(k.api_key, 'API Key 已复制')">
                      <Icon name="copy" />
                    </button>
                  </div>
                </td>
                <td class="whitespace-nowrap text-slate-600 dark:text-slate-300">
                  {{ k.rate_limit_num }} 次 / {{ k.rate_limit_window }}s
                </td>
                <td class="whitespace-nowrap">
                  <span v-if="!k.expires_at" class="text-slate-400">永久</span>
                  <template v-else>
                    <span class="text-slate-600 dark:text-slate-300">{{ k.expires_at.slice(0, 10) }}</span>
                    <span v-if="isExpired(k)" class="badge bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 ml-1">已过期</span>
                  </template>
                </td>
                <td>
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">总 {{ k.total_calls }}</span>
                    <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">成 {{ k.total_success }}</span>
                    <span class="badge bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">败 {{ k.total_failed }}</span>
                    <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">24h {{ k.calls_24h }}</span>
                  </div>
                </td>
                <td>
                  <button
                    class="badge cursor-pointer transition-colors"
                    :class="Number(k.enabled)
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'"
                    :title="Number(k.enabled) ? '点击停用' : '点击启用'"
                    @click="toggleEnabled(k)"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="Number(k.enabled) ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ Number(k.enabled) ? '启用中' : '已停用' }}
                  </button>
                </td>
                <td class="text-slate-500 dark:text-slate-400 whitespace-nowrap">{{ formatTime(k.last_used_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="统计报表" @click="openStats(k)">
                      <Icon name="activity" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(k)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20" title="重置 Key" @click="askRegenerate(k)">
                      <Icon name="refresh" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteOne(k)">
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!keys.length" message="还没有 API Key，点击「生成新 Key」为业务方分发凭证" icon="key" />
      </template>

      <div v-if="total > pageSize" class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
        <p class="text-slate-500">共 {{ total }} 个，第 {{ page }} / {{ totalPages }} 页</p>
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

    <!-- Usage doc -->
    <div class="card p-5">
      <h3 class="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
        <Icon name="info" class="text-brand-500" /> 核销接口调用说明
      </h3>
      <div class="space-y-2 text-slate-500 dark:text-slate-400">
        <p>买家在闲鱼收到卡密型卡券发货生成的卡密后，业务方系统携带分发的 API Key 调用核销接口完成验证：</p>
        <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">POST /api/verify-codes/verify
Authorization: Bearer xyk_xxxxxxxx...
Content-Type: application/json

{ "code": "A3b9xK" }</pre>
        <p>统一响应格式：</p>
        <pre class="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 font-mono overflow-x-auto whitespace-pre-wrap">验证成功 → 200 { "success": true, "msg": "验证成功", "data": { "code": "...", "card_name": "...", "order_id": "...", "item_id": "...", "buyer_id": "...", "used_at": "..." } }
验证失败 → 200 { "success": false, "msg": "验证失败: 卡密不存在/已被使用/格式错误", "data": {} }
鉴权/停用/过期/限速 → 401/403/429 { "success": false, "msg": "原因", "data": {} }</pre>
        <p>验证成功后卡密立即失效（可在「卡券管理 → 卡密生成记录」查看全部核销状态）；每个 Key 独立限速（默认 30 次/60 秒，超限 429）+ 可配置有效期（到期后 403）。</p>
      </div>
    </div>

    <!-- Create/Edit modal -->
    <ModalBase v-model="modalOpen" :title="editing ? '编辑 API Key' : '生成新 API Key'" size="md">
      <div class="space-y-4">
        <div>
          <label class="label">业务方名称 <span class="text-red-500">*</span></label>
          <input v-model="form.name" class="input" placeholder="如 发卡平台A / 充值站B" />
        </div>
        <div>
          <label class="label">状态</label>
          <label class="flex items-center gap-3 cursor-pointer select-none">
            <ToggleSwitch v-model="form.enabled" />
            <span>
              <span class="text-slate-700 dark:text-slate-200">{{ form.enabled ? '启用中' : '已停用' }}</span>
              <span class="block mt-0.5 text-slate-400">停用后该 Key 的所有调用立即返回 403</span>
            </span>
          </label>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">限速次数</label>
            <input v-model.number="form.rate_limit_num" type="number" min="1" class="input" />
          </div>
          <div>
            <label class="label">限速窗口 (秒)</label>
            <input v-model.number="form.rate_limit_window" type="number" min="1" class="input" />
          </div>
        </div>
        <p class="text-slate-400 -mt-2">滑动窗口限速, 默认 30 次 / 60 秒, 超限请求返回 429</p>
        <div>
          <label class="label">有效期</label>
          <div class="grid grid-cols-5 gap-2">
            <button
              v-for="o in EXPIRY_OPTIONS"
              :key="o.value"
              type="button"
              class="rounded-lg border px-2 py-2 transition-colors"
              :class="form.expiryMode === o.value
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'"
              @click="form.expiryMode = o.value"
            >
              {{ o.label }}
            </button>
          </div>
          <input v-if="form.expiryMode === 'custom'" v-model="form.expiryDate" type="date" class="input mt-2" />
          <p class="mt-1 text-slate-400">到期后该 Key 调用核销接口返回 403；选择永久则一直有效</p>
        </div>
        <div>
          <label class="label">备注 (可选)</label>
          <input v-model="form.remark" class="input" placeholder="对接系统 / 负责人 / 用途说明" />
        </div>
        <div v-if="newlyCreatedKey" class="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
          <p class="text-emerald-700 dark:text-emerald-300 font-medium mb-1">新 Key 已生成（请立即复制保存）:</p>
          <div class="flex items-center gap-2">
            <code class="font-mono text-emerald-800 dark:text-emerald-200 break-all flex-1">{{ newlyCreatedKey }}</code>
            <button class="btn-secondary shrink-0" @click="copyText(newlyCreatedKey, 'API Key 已复制')">
              <Icon name="copy" /> 复制
            </button>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="modalOpen = false">{{ newlyCreatedKey ? '完成' : '取消' }}</button>
        <button v-if="!newlyCreatedKey" class="btn-primary" :disabled="saving" @click="save">
          <Icon name="save" v-if="!saving" />
          <Icon name="refresh" v-else class="animate-spin" />
          保存
        </button>
      </template>
    </ModalBase>

    <!-- Stats modal -->
    <ModalBase v-model="statsOpen" :title="statsKey ? `调用统计 · ${statsKey.name}` : '调用统计'" size="lg">
      <div v-if="statsLoading" class="p-10 flex items-center justify-center text-slate-400">
        <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
      </div>
      <div v-else-if="stats" class="space-y-5">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-center">
            <p class="text-slate-400">总调用</p>
            <p class="text-xl font-bold text-slate-800 dark:text-white mt-1">{{ stats.totals.total_calls }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-center">
            <p class="text-slate-400">成功</p>
            <p class="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{{ stats.totals.total_success }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-center">
            <p class="text-slate-400">失败</p>
            <p class="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1">{{ stats.totals.total_failed }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-center">
            <p class="text-slate-400">近 24h</p>
            <p class="text-xl font-bold text-brand-600 dark:text-brand-400 mt-1">{{ stats.totals.calls_24h }}</p>
          </div>
        </div>

        <div>
          <p class="font-medium text-slate-700 dark:text-slate-200 mb-2">近 24 小时调用</p>
          <div class="flex items-end gap-1 h-28">
            <div v-for="h in stats.hourly" :key="h.bucket" class="flex-1 flex flex-col items-center justify-end h-full group relative">
              <div
                class="w-full rounded-t bg-brand-500/80 group-hover:bg-brand-500 transition-colors min-h-[2px]"
                :style="{ height: barHeight(h.total, maxHourly) }"
              />
              <span class="absolute -top-5 hidden group-hover:block bg-slate-800 text-white rounded px-1.5 py-0.5 whitespace-nowrap">{{ h.bucket.slice(11) }}时 · {{ h.total }} 次</span>
            </div>
          </div>
          <div class="flex justify-between text-slate-400 mt-1">
            <span>{{ stats.hourly[0]?.bucket.slice(5, 16).replace('T', ' ') }}</span>
            <span>现在</span>
          </div>
        </div>

        <div>
          <p class="font-medium text-slate-700 dark:text-slate-200 mb-2">近 7 天调用</p>
          <div class="flex items-end gap-2 h-28">
            <div v-for="d in stats.daily" :key="d.bucket" class="flex-1 flex flex-col items-center justify-end h-full gap-1">
              <span class="text-slate-500">{{ d.total }}</span>
              <div
                class="w-full rounded-t bg-emerald-500/80 min-h-[2px]"
                :style="{ height: barHeight(d.total, maxDaily) }"
              />
              <span class="text-slate-400">{{ d.bucket.slice(5) }}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <p class="font-medium text-slate-700 dark:text-slate-200">最近调用日志</p>
            <button class="btn-ghost" :disabled="logsLoading" @click="loadLogs">
              <Icon name="refresh" :class="logsLoading ? 'animate-spin' : ''" />
            </button>
          </div>
          <div class="max-h-64 overflow-y-auto table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>结果</th>
                  <th>说明</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in logs" :key="l.id">
                  <td class="whitespace-nowrap text-slate-500">{{ formatTime(l.created_at) }}</td>
                  <td>
                    <span class="badge" :class="Number(l.success) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'">
                      {{ Number(l.success) ? '成功' : `失败 ${l.status_code}` }}
                    </span>
                  </td>
                  <td class="text-slate-500">{{ l.message || '—' }}</td>
                  <td class="font-mono text-slate-400">{{ l.ip }}</td>
                </tr>
                <tr v-if="!logs.length">
                  <td colspan="4" class="text-center text-slate-400 py-6">暂无调用记录</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ModalBase>

    <!-- Regenerate confirm modal -->
    <ModalBase :model-value="!!regenTarget" title="重置 API Key" size="sm" @update:model-value="regenTarget = null" @close="regenTarget = null">
      <div class="py-2 space-y-3">
        <div class="text-center">
          <div class="w-12 h-12 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-500 mb-3">
            <Icon name="alert" class="text-xl" />
          </div>
          <p class="text-slate-500">
            确认重置 <span class="font-medium text-slate-800 dark:text-slate-200">{{ regenTarget?.name }}</span> 的 API Key？
          </p>
        </div>
        <p class="text-center text-slate-400">重置后旧 Key 即时作废, 对接业务方需更换新 Key; 调用统计保留</p>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="regenTarget = null">取消</button>
        <button class="btn-primary flex-1" :disabled="regenerating" @click="doRegenerate">
          <Icon name="refresh" v-if="regenerating" class="animate-spin" />
          确认重置
        </button>
      </template>
    </ModalBase>

    <!-- Delete confirm modal -->
    <ModalBase :model-value="!!deleteTarget" title="删除 API Key" size="sm" @update:model-value="deleteTarget = null" @close="deleteTarget = null">
      <div class="text-center py-2">
        <div class="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500 mb-3">
          <Icon name="alert" class="text-xl" />
        </div>
        <p class="text-slate-500">
          确认删除业务方 <span class="font-medium text-slate-800 dark:text-slate-200">{{ deleteTarget?.name }}</span> 的 API Key？该 Key 将立即失效。
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
import { getApiKeys, createApiKey, updateApiKey, deleteApiKey, regenerateApiKey, getApiKeyStats, getApiKeyLogs } from '~/api/api-keys'
import type { ApiKeyRow, ApiKeyStats, ApiKeyLogRow } from '~/api/api-keys'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const regenerating = ref(false)
const keys = ref<ApiKeyRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const enabledFilter = ref('')
const visibleKeyId = ref(0)

const modalOpen = ref(false)
const editing = ref(false)
const editingId = ref(0)
const newlyCreatedKey = ref('')
const EXPIRY_OPTIONS = [
  { value: 'forever', label: '永久' },
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: 'custom', label: '自定义' },
]
const form = ref<any>({ name: '', rate_limit_num: 30, rate_limit_window: 60, enabled: true, remark: '', expiryMode: 'forever', expiryDate: '' })

const statsOpen = ref(false)
const statsLoading = ref(false)
const statsKey = ref<ApiKeyRow | null>(null)
const stats = ref<ApiKeyStats | null>(null)
const logs = ref<ApiKeyLogRow[]>([])
const logsLoading = ref(false)

const regenTarget = ref<ApiKeyRow | null>(null)
const deleteTarget = ref<ApiKeyRow | null>(null)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const maxHourly = computed(() => Math.max(1, ...(stats.value?.hourly || []).map((h) => h.total)))
const maxDaily = computed(() => Math.max(1, ...(stats.value?.daily || []).map((d) => d.total)))

function maskKey(key: string) {
  if (!key) return ''
  return `${key.slice(0, 8)}${'•'.repeat(10)}${key.slice(-4)}`
}

function barHeight(v: number, max: number) {
  if (!max) return '0%'
  return `${Math.max(4, Math.round((v / max) * 100))}%`
}

async function copyText(text: string, msg = '已复制') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(msg)
  } catch {
    toast.error('复制失败, 请手动选择复制')
  }
}

async function reload() {
  loading.value = true
  try {
    const res = await getApiKeys({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      enabled: enabledFilter.value || undefined,
    })
    keys.value = res.data
    total.value = res.total
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

function openCreate() {
  editing.value = false
  editingId.value = 0
  newlyCreatedKey.value = ''
  form.value = { name: '', rate_limit_num: 30, rate_limit_window: 60, enabled: true, remark: '', expiryMode: 'forever', expiryDate: '' }
  modalOpen.value = true
}

function openEdit(k: ApiKeyRow) {
  editing.value = true
  editingId.value = k.id
  newlyCreatedKey.value = ''
  form.value = {
    name: k.name,
    rate_limit_num: k.rate_limit_num,
    rate_limit_window: k.rate_limit_window,
    enabled: !!Number(k.enabled),
    remark: k.remark || '',
    expiryMode: k.expires_at ? 'custom' : 'forever',
    expiryDate: k.expires_at ? String(k.expires_at).slice(0, 10) : '',
  }
  modalOpen.value = true
}

function dateAfterDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

function isExpired(k: ApiKeyRow): boolean {
  if (!k.expires_at) return false
  const t = new Date(String(k.expires_at).replace(' ', 'T') + 'Z').getTime()
  return Number.isFinite(t) && Date.now() >= t
}

function resolveExpiresAt(): string | null {
  if (form.value.expiryMode === 'forever') return null
  if (form.value.expiryMode === 'custom') {
    if (!form.value.expiryDate) {
      toast.error('请选择自定义有效期日期')
      throw new Error('expiry required')
    }
    return form.value.expiryDate
  }
  return dateAfterDays(Number(form.value.expiryMode))
}

async function save() {
  if (!form.value.name.trim()) {
    toast.error('请填写业务方名称')
    return
  }
  let expires_at: string | null
  try {
    expires_at = resolveExpiresAt()
  } catch {
    return
  }
  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      rate_limit_num: Math.max(1, Number(form.value.rate_limit_num) || 30),
      rate_limit_window: Math.max(1, Number(form.value.rate_limit_window) || 60),
      enabled: !!form.value.enabled,
      remark: (form.value.remark || '').trim(),
      expires_at,
    }
    if (editing.value) {
      await updateApiKey(editingId.value, payload)
      toast.success('API Key 已更新')
    } else {
      const r = await createApiKey(payload)
      newlyCreatedKey.value = r.api_key
      toast.success('API Key 已生成')
      reload()
      return
    }
    modalOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(k: ApiKeyRow) {
  try {
    await updateApiKey(k.id, { enabled: !Number(k.enabled) })
    toast.success(Number(k.enabled) ? `「${k.name}」已停用` : `「${k.name}」已启用`)
    reload()
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

function askRegenerate(k: ApiKeyRow) {
  regenTarget.value = k
}

async function doRegenerate() {
  if (!regenTarget.value) return
  regenerating.value = true
  try {
    const r = await regenerateApiKey(regenTarget.value.id)
    newlyCreatedKey.value = r.api_key
    editing.value = true
    editingId.value = 0
    regenTarget.value = null
    modalOpen.value = true
    reload()
  } catch (e: any) {
    toast.error(e.message || '重置失败')
  } finally {
    regenerating.value = false
  }
}

async function deleteOne(k: ApiKeyRow) {
  deleteTarget.value = k
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteApiKey(deleteTarget.value.id)
    toast.success('API Key 已删除')
    deleteTarget.value = null
    reload()
  } catch (e: any) {
    toast.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

async function openStats(k: ApiKeyRow) {
  statsKey.value = k
  stats.value = null
  logs.value = []
  statsOpen.value = true
  statsLoading.value = true
  try {
    stats.value = await getApiKeyStats(k.id)
    await loadLogs()
  } catch (e: any) {
    toast.error(e.message || '统计加载失败')
  } finally {
    statsLoading.value = false
  }
}

async function loadLogs() {
  if (!statsKey.value) return
  logsLoading.value = true
  try {
    const r = await getApiKeyLogs(statsKey.value.id, { pageSize: 50 })
    logs.value = r.data
  } catch (e: any) {
    toast.error(e.message || '日志加载失败')
  } finally {
    logsLoading.value = false
  }
}

function formatTime(t?: string | null) {
  if (!t) return '—'
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
