<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="账号管理" description="维护闲鱼账号 Cookie 与启停、自动确认、暂停时长等">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn-secondary" @click="openQrLogin">
          <Icon name="qrcode" /> 扫码登录
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
                <th>来源</th>
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
                  <span v-if="a.xianyu_uid" class="block text-xs text-slate-400 font-mono">UID: {{ a.xianyu_uid }}</span>
                </td>
                <td>
                  <span class="badge" :class="a.login_type === 'qrcode' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'">
                    <Icon :name="a.login_type === 'qrcode' ? 'qrcode' : 'lock'" />
                    {{ a.login_type === 'qrcode' ? '扫码' : 'Cookie' }}
                  </span>
                </td>
                <td>
                  <span class="badge" :class="a.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400'">
                    <span class="w-1.5 h-1.5 rounded-full" :class="a.enabled ? 'bg-emerald-500' : 'bg-slate-400'" />
                    {{ a.enabled ? '运行中' : '已停用' }}
                  </span>
                  <span v-if="a.cookie_status_text" class="block text-[10px] mt-1" :class="a.cookie_status_text === 'valid' ? 'text-emerald-500' : a.cookie_status_text === 'invalid' ? 'text-rose-500' : 'text-slate-400'">
                    {{ a.cookie_status_text === 'valid' ? 'Cookie有效' : a.cookie_status_text === 'invalid' ? 'Cookie失效' : a.cookie_status_text }}
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
                <td :title="`人工回复后暂停自动回复时长 (分钟)`">{{ a.pause_duration }}分</td>
                <td>
                  <NuxtLink :to="`/keywords?cookie_id=${encodeURIComponent(a.id)}`" class="text-sky-600 hover:underline">
                    {{ a.keyword_count }} 条
                  </NuxtLink>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(a.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost !px-2 !py-1" title="验证 Cookie" @click="verifyCookie(a)">
                      <Icon name="shield" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="编辑" @click="openEdit(a)">
                      <Icon name="edit" />
                    </button>
                    <button class="btn-ghost !px-2 !py-1" title="默认回复" @click="openDefaultReply(a)">
                      <Icon name="msgNotify" />
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
            <label class="label">人工回复后暂停自动回复 (分钟, 0=不暂停)</label>
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

    <!-- QR Scan Login modal -->
    <ModalBase v-model="qrModalOpen" title="扫码登录闲鱼" size="md" @close="onQrClose">
      <div class="py-2">
        <!-- Step 1: starting -->
        <div v-if="qrState === 'starting'" class="text-center py-10 text-slate-400">
          <Icon name="refresh" class="animate-spin text-2xl mb-3" />
          <p class="text-sm">正在生成二维码...</p>
        </div>
        <!-- Step 2: waiting/scanned -->
        <div v-else-if="qrState === 'waiting' || qrState === 'scanned'" class="text-center">
          <div class="relative inline-block p-3 bg-white rounded-xl border border-slate-200 dark:border-slate-700">
            <img
              v-if="qrUrl"
              :src="`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrUrl)}`"
              alt="闲鱼登录二维码"
              class="w-60 h-60"
              @error="onQrImgError"
            />
            <div v-if="qrState === 'scanned'" class="absolute inset-0 bg-white/80 dark:bg-slate-900/80 rounded-xl flex flex-col items-center justify-center">
              <div class="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-500 mb-2">
                <Icon name="check" class="text-2xl" />
              </div>
              <p class="text-sm font-medium text-emerald-600 dark:text-emerald-400">已扫描，请在手机上确认</p>
            </div>
          </div>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-4">
            请使用 <span class="font-medium text-slate-700 dark:text-slate-200">闲鱼 App</span> 扫描上方二维码完成登录
          </p>
          <p v-if="qrState === 'waiting'" class="text-xs text-slate-400 mt-1">二维码有效期约 2 分钟，请尽快扫描</p>
          <div v-if="qrUrlFallback" class="mt-3 text-xs text-slate-400 break-all font-mono bg-slate-50 dark:bg-slate-800/50 p-2 rounded">
            {{ qrUrlFallback }}
          </div>
        </div>
        <!-- Step 3: success -->
        <div v-else-if="qrState === 'success'" class="text-center py-6">
          <div class="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-500 mb-3">
            <Icon name="check" class="text-3xl" />
          </div>
          <p class="text-base font-semibold text-slate-800 dark:text-slate-100">登录成功</p>
          <p class="text-sm text-slate-500 mt-1">闲鱼账号已自动添加到账号列表</p>
          <p v-if="qrAccountNick" class="text-xs text-slate-400 mt-1">{{ qrAccountNick }}</p>
        </div>
        <!-- Step 4: verification_required -->
        <div v-else-if="qrState === 'verification_required'" class="text-center py-6">
          <div class="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-500 mb-3">
            <Icon name="alert" class="text-3xl" />
          </div>
          <p class="text-base font-semibold text-slate-800 dark:text-slate-100">需要人脸验证</p>
          <p class="text-sm text-slate-500 mt-1">该账号触发了风控，请在手机端完成人脸验证后重试</p>
        </div>
        <!-- Step 5: expired/error -->
        <div v-else class="text-center py-6">
          <div class="w-16 h-16 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
            <Icon name="alert" class="text-3xl" />
          </div>
          <p class="text-base font-semibold text-slate-800 dark:text-slate-100">{{ qrState === 'expired' ? '二维码已过期' : '登录失败' }}</p>
          <p v-if="qrError" class="text-sm text-slate-500 mt-1">{{ qrError }}</p>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary flex-1" @click="onQrClose">关闭</button>
        <button v-if="qrState === 'expired' || qrState === 'error' || qrState === 'verification_required'" class="btn-primary flex-1" @click="openQrLogin">
          <Icon name="refresh" /> 重新生成
        </button>
      </template>
    </ModalBase>

    <!-- 默认回复弹窗 (账号级, 引擎回复链第 4 层; 未启用时回退系统全局 default_reply 设置) -->
    <ModalBase v-model="drModalOpen" :title="`默认回复 · ${drAccount?.remark || drAccount?.id || ''}`" size="md">
      <div class="space-y-4">
        <p class="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          关键词、AI、指定商品回复都未命中时, 引擎用这里的内容兜底回复。支持变量
          <code class="px-1 rounded bg-slate-100 dark:bg-slate-800">{send_user_name}</code>、
          <code class="px-1 rounded bg-slate-100 dark:bg-slate-800">{item_id}</code>。
        </p>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="drForm.enabled" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-base text-slate-700 dark:text-slate-200">启用此账号的默认回复</span>
        </label>
        <div>
          <label class="label">回复文本</label>
          <textarea v-model="drForm.reply_content" rows="4" class="input" placeholder="例如: 你好呀, 很高兴见到你~ 有问题随时问我!" />
        </div>
        <div>
          <label class="label">回复图片 URL <span class="text-slate-400 text-xs">(可选, 与文本一起发送)</span></label>
          <input v-model="drForm.reply_image_url" class="input" placeholder="https://..." />
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="drForm.reply_once" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-base text-slate-700 dark:text-slate-200">每个会话只回复一次</span>
          <span v-if="drRecordsCount > 0" class="text-sm text-slate-400">(已记录 {{ drRecordsCount }} 个会话)</span>
        </label>
      </div>
      <template #footer>
        <button class="btn-secondary" :disabled="drSaving" @click="clearDrRecords">清空回复记录</button>
        <button class="btn-secondary flex-1" @click="drModalOpen = false">取消</button>
        <button class="btn-primary flex-1" :disabled="drSaving" @click="saveDr">
          <Icon name="save" /> {{ drSaving ? '保存中...' : '保存' }}
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getAccounts, getAccountHealth, getAccount, createAccount, updateAccount, deleteAccount, updateAccountStatus, updateAccountAutoConfirm, verifyCookie as verifyCookieApi } from '~/api/accounts'
import type { Account, AccountHealth } from '~/api/accounts'
import { startQrLogin, pollQrStatus, cancelQrLogin } from '~/api/qr-login'
import { getDefaultReply, saveDefaultReply, clearDefaultReplyRecords } from '~/api/default-replies'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const accounts = ref<Account[]>([])
const keyword = ref('')
const modalOpen = ref(false)
const editing = ref(false)
const deleteTarget = ref<Account | null>(null)

// QR scan login state
type QrState = 'starting' | 'waiting' | 'scanned' | 'success' | 'expired' | 'verification_required' | 'error'
const qrModalOpen = ref(false)
const qrState = ref<QrState>('starting')
const qrUrl = ref('')
const qrUrlFallback = ref('')
const qrSessionKey = ref('')
const qrError = ref('')
const qrAccountNick = ref('')
let qrPollTimer: ReturnType<typeof setInterval> | null = null
const verifyingIds = ref<Set<string>>(new Set())

// 默认回复弹窗状态 (账号级)
const drModalOpen = ref(false)
const drSaving = ref(false)
const drAccount = ref<Account | null>(null)
const drRecordsCount = ref(0)
const drForm = ref({ enabled: false, reply_content: '', reply_image_url: '', reply_once: false })

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
      getAccounts(),
      getAccountHealth().catch(() => []),
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

/* ---------- 默认回复 (账号级) ---------- */

async function openDefaultReply(a: Account) {
  drAccount.value = a
  drModalOpen.value = true
  try {
    const d = await getDefaultReply(a.id)
    drForm.value = {
      enabled: !!d.enabled,
      reply_content: d.reply_content || '',
      reply_image_url: d.reply_image_url || '',
      reply_once: !!d.reply_once,
    }
    drRecordsCount.value = Number(d.records_count || 0)
  } catch (e: any) {
    toast.error(e.message || '读取默认回复失败')
  }
}

async function saveDr() {
  if (!drAccount.value) return
  if (drForm.value.enabled && !drForm.value.reply_content.trim() && !drForm.value.reply_image_url.trim()) {
    toast.error('启用默认回复时必须填写回复文本或图片 URL')
    return
  }
  drSaving.value = true
  try {
    await saveDefaultReply(drAccount.value.id, {
      enabled: drForm.value.enabled,
      reply_content: drForm.value.reply_content.trim(),
      reply_image_url: drForm.value.reply_image_url.trim(),
      reply_once: drForm.value.reply_once,
    })
    toast.success('默认回复已保存')
    drModalOpen.value = false
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    drSaving.value = false
  }
}

async function clearDrRecords() {
  if (!drAccount.value) return
  drSaving.value = true
  try {
    const d = await clearDefaultReplyRecords(drAccount.value.id)
    drRecordsCount.value = 0
    toast.success(`已清空 ${d.cleared} 条回复记录, "只回复一次"将重新生效`)
  } catch (e: any) {
    toast.error(e.message || '清空失败')
  } finally {
    drSaving.value = false
  }
}

function openEdit(a: Account) {
  editing.value = true
  getAccount(a.id).then((d) => {
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
      await updateAccount(form.value.id, {
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
      await createAccount({
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
    const r = await updateAccountStatus(a.id, !a.enabled)
    a.enabled = r.enabled
    toast.success(r.enabled ? '已启用' : '已停用')
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function toggleAutoConfirm(a: Account) {
  try {
    const r = await updateAccountAutoConfirm(a.id, !a.auto_confirm)
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
    await deleteAccount(deleteTarget.value.id)
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

// ===== QR Scan Login =====
function stopQrPoll() {
  if (qrPollTimer) {
    clearInterval(qrPollTimer)
    qrPollTimer = null
  }
}

async function openQrLogin() {
  stopQrPoll()
  qrModalOpen.value = true
  qrState.value = 'starting'
  qrUrl.value = ''
  qrUrlFallback.value = ''
  qrSessionKey.value = ''
  qrError.value = ''
  qrAccountNick.value = ''
  try {
    const r = await startQrLogin()
    qrSessionKey.value = r.sessionKey
    qrUrl.value = r.qrUrl
    qrUrlFallback.value = r.qrUrl
    qrState.value = 'waiting'
    startQrPoll()
  } catch (e: any) {
    qrState.value = 'error'
    qrError.value = e.message || '生成二维码失败'
  }
}

function startQrPoll() {
  stopQrPoll()
  qrPollTimer = setInterval(async () => {
    if (!qrSessionKey.value || qrState.value === 'success' || qrState.value === 'expired' || qrState.value === 'error' || qrState.value === 'verification_required') {
      stopQrPoll()
      return
    }
    try {
      const r = await pollQrStatus(qrSessionKey.value)
      const st = r.status
      if (st === 'waiting') qrState.value = 'waiting'
      else if (st === 'scanned') qrState.value = 'scanned'
      else if (st === 'success') {
        qrState.value = 'success'
        qrAccountNick.value = r.xianyuNick || r.xianyuUid || ''
        stopQrPoll()
        toast.success('闲鱼账号登录成功')
        reload()
      } else if (st === 'verification_required') {
        qrState.value = 'verification_required'
        stopQrPoll()
      } else if (st === 'expired') {
        qrState.value = 'expired'
        stopQrPoll()
      }
    } catch {
      // network hiccup — keep polling
    }
  }, 2500)
}

function onQrClose() {
  stopQrPoll()
  qrModalOpen.value = false
  if (qrSessionKey.value) {
    cancelQrLogin(qrSessionKey.value).catch(() => {})
  }
}

function onQrImgError() {
  qrUrlFallback.value = qrUrl.value
}

async function verifyCookie(a: Account) {
  if (verifyingIds.value.has(a.id)) return
  verifyingIds.value.add(a.id)
  try {
    const r = await verifyCookieApi(a.id)
    a.cookie_status_text = r.valid ? 'valid' : 'invalid'
    a.last_check_at = r.checkedAt
    toast.success(r.valid ? 'Cookie 验证有效' : 'Cookie 已失效，请重新登录')
  } catch (e: any) {
    toast.error(e.message || '验证失败')
  } finally {
    verifyingIds.value.delete(a.id)
  }
}

onBeforeUnmount(() => {
  stopQrPoll()
  if (import.meta.client) window.removeEventListener('app:refresh', reload)
})
onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
</script>
