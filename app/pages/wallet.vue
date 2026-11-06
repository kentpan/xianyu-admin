<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="我的钱包" description="余额、提现、收款信息、对接码与提货秘钥">
      <template #actions>
        <NuxtLink to="/distribution/fund-flows" class="btn-secondary">
          <Icon name="coins" /> 资金流水
        </NuxtLink>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <div v-if="loading && !wallet" class="card p-10 flex items-center justify-center text-slate-400">
      <Icon name="refresh" class="animate-spin mr-2" /> 加载中...
    </div>

    <template v-else>
      <!-- Balance + actions -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="md:col-span-2 card p-6 relative overflow-hidden">
          <div class="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-brand-500/10 blur-3xl" />
          <div class="relative">
            <div class="flex items-center gap-2 text-slate-400 text-sm">
              <Icon name="wallet" /> 账户余额
            </div>
            <p class="mt-2 text-4xl font-bold tabular-nums text-slate-900 dark:text-white">
              ¥<span class="ml-1">{{ wallet?.balance || '0.00' }}</span>
            </p>
            <div class="mt-4 flex items-center gap-2 flex-wrap">
              <button class="btn-primary" @click="openWithdraw">
                <Icon name="download" /> 提现
              </button>
              <NuxtLink to="/distribution/fund-flows" class="btn-secondary">
                <Icon name="coins" /> 流水明细
              </NuxtLink>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-4">
          <StatCard label="资金流水笔数" :value="wallet?.fund_flow_count || 0" icon="coins" color="sky" />
          <StatCard label="待处理提现" :value="wallet?.pending_withdraw_count || 0" icon="clock" color="amber" />
        </div>
      </div>

      <!-- Two-column layout: payment info + dock code -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <!-- Payment info -->
        <div class="card p-6">
          <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Icon name="qrcode" class="text-brand-500" /> 收款信息
          </h3>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label">收款方式</label>
                <select v-model="paymentForm.payment_type" class="input">
                  <option value="alipay">支付宝</option>
                  <option value="wechat">微信</option>
                </select>
              </div>
              <div>
                <label class="label">支付宝账号 <span class="text-xs text-slate-400">(可选)</span></label>
                <input v-model="paymentForm.alipay_id" class="input" placeholder="邮箱/手机号" />
              </div>
            </div>
            <div>
              <label class="label">收款码 URL <span class="text-red-500">*</span></label>
              <input v-model="paymentForm.payment_qrcode" class="input" placeholder="https://.../qrcode.png" />
              <p class="text-xs text-slate-400 mt-1">提现申请时将自动附带该收款码供管理员核对</p>
            </div>
            <div v-if="paymentForm.payment_qrcode" class="flex items-center gap-3">
              <img :src="paymentForm.payment_qrcode" alt="收款码" class="w-20 h-20 rounded-lg border border-slate-200 dark:border-slate-700 object-cover" @error="onQrError" />
              <a :href="paymentForm.payment_qrcode" target="_blank" class="text-xs text-brand-600 hover:underline flex items-center gap-1">
                <Icon name="external" /> 查看大图
              </a>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn-primary" :disabled="savingPayment" @click="savePayment">
                <Icon v-if="savingPayment" name="refresh" class="animate-spin" />
                <Icon v-else name="save" /> 保存收款信息
              </button>
            </div>
          </div>
        </div>

        <!-- Dock code + secret key -->
        <div class="card p-6 space-y-5">
          <div>
            <h3 class="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
              <Icon name="link" class="text-brand-500" /> 对接码
            </h3>
            <p class="text-xs text-slate-400 mb-2">货主添加你为指定分销商时使用；重置后旧绑定与对接记录将一并清空。</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono text-base tracking-wider text-slate-900 dark:text-white">{{ dockCode || '—' }}</code>
              <button class="btn-ghost !py-2 !px-2" title="复制" @click="copyText(dockCode, '对接码已复制')">
                <Icon name="copy" />
              </button>
              <button class="btn-secondary !py-2" :disabled="resettingCode" @click="resetDockCode">
                <Icon v-if="resettingCode" name="refresh" class="animate-spin" />
                <Icon v-else name="refresh" /> 重置
              </button>
            </div>
          </div>
          <div class="border-t border-slate-100 dark:border-slate-700 pt-5">
            <h3 class="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
              <Icon name="lock" class="text-brand-500" /> 提货秘钥
            </h3>
            <p class="text-xs text-slate-400 mb-2">用于生成提货链接；重置后旧提货链接立即失效。</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono text-xs tracking-wider text-slate-900 dark:text-white truncate" :title="secretKey">{{ secretKey ? secretKey.slice(0, 16) + '…' : '—' }}</code>
              <button class="btn-ghost !py-2 !px-2" title="复制" @click="copyText(secretKey, '提货秘钥已复制')">
                <Icon name="copy" />
              </button>
              <button class="btn-secondary !py-2" :disabled="resettingSecret" @click="resetSecretKey">
                <Icon v-if="resettingSecret" name="refresh" class="animate-spin" />
                <Icon v-else name="refresh" /> 重置
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent withdrawals -->
      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Icon name="clock" class="text-brand-500" /> 最近提现
          </h3>
          <NuxtLink to="/distribution/fund-flows" class="text-xs text-brand-600 hover:underline">查看全部流水 →</NuxtLink>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>金额</th>
                <th>方式</th>
                <th>状态</th>
                <th>申请时间</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in settlements" :key="s.id">
                <td><span class="font-semibold tabular-nums text-slate-900 dark:text-white">¥{{ s.amount || '0.00' }}</span></td>
                <td>{{ paymentLabel(s.payment_type) }}</td>
                <td>
                  <span class="badge" :class="settlementStatusMeta(s.status).cls">
                    <span class="w-1.5 h-1.5 rounded-full" :class="settlementStatusMeta(s.status).dot" />
                    {{ settlementStatusMeta(s.status).label }}
                  </span>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(s.created_at) }}</td>
                <td class="max-w-[240px]">
                  <p class="truncate text-xs text-slate-500 dark:text-slate-400" :title="s.reject_reason || s.remark || ''">
                    {{ s.reject_reason || s.remark || '—' }}
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!settlements.length" message="还没有提现记录" icon="wallet" />
      </div>

      <!-- Recent fund flows -->
      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Icon name="coins" class="text-brand-500" /> 最近资金流水
          </h3>
          <NuxtLink to="/distribution/fund-flows" class="text-xs text-brand-600 hover:underline">查看全部 →</NuxtLink>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>类型</th>
                <th>金额</th>
                <th>变动后余额</th>
                <th>描述</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in recentFlows" :key="f.id">
                <td>
                  <span class="badge" :class="flowTypeMeta(f.type).cls">
                    {{ flowTypeMeta(f.type).label }}
                  </span>
                </td>
                <td>
                  <span class="font-semibold tabular-nums" :class="flowAmountClass(f.type)">
                    {{ flowAmountDisplay(f.type, f.amount) }}
                  </span>
                </td>
                <td><span class="tabular-nums text-slate-700 dark:text-slate-200">¥{{ f.balance_after || '0.00' }}</span></td>
                <td class="max-w-[300px]">
                  <p class="truncate text-slate-700 dark:text-slate-200" :title="f.description">{{ f.description || '—' }}</p>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(f.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!recentFlows.length" message="暂无流水" icon="coins" />
      </div>
    </template>

    <!-- Withdraw modal -->
    <ModalBase v-model="withdrawOpen" title="申请提现" size="sm">
      <div class="space-y-4">
        <div class="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
          <p class="text-xs text-slate-400">可提现余额</p>
          <p class="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">¥{{ wallet?.balance || '0.00' }}</p>
        </div>
        <div>
          <label class="label">提现金额 <span class="text-red-500">*</span></label>
          <input v-model="withdrawForm.amount" type="number" min="0" step="0.01" class="input" placeholder="如 100.00" />
          <p class="text-xs text-slate-400 mt-1">提现到 <span class="font-medium">{{ paymentLabel(paymentForm.payment_type) }}</span> 收款码</p>
        </div>
        <div v-if="!paymentForm.payment_qrcode" class="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-300">
          <Icon name="alert" class="inline mr-1" />
          请先填写并保存收款码后再发起提现。
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="withdrawOpen = false">取消</button>
        <button class="btn-primary" :disabled="withdrawing" @click="submitWithdraw">
          <Icon name="save" v-if="!withdrawing" />
          <Icon name="refresh" v-else class="animate-spin" />
          {{ withdrawing ? '提交中...' : '确认提现' }}
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getWallet } from '~/api/payment'
import type { Wallet, SettlementRecord } from '~/api/payment'
import { getDockCode, getSecretKey, getPaymentInfo, getUserBalance, resetDockCode as resetDockCodeApi, resetSecretKey as resetSecretKeyApi, updatePaymentInfo } from '~/api/user'
import type { FundFlowLite } from '~/api/user'
import { getPaymentSettlementRecords, requestWithdraw } from '~/api/payment'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const savingPayment = ref(false)
const resettingCode = ref(false)
const resettingSecret = ref(false)
const withdrawing = ref(false)
const wallet = ref<Wallet | null>(null)
const dockCode = ref('')
const secretKey = ref('')
const settlements = ref<SettlementRecord[]>([])
const recentFlows = ref<FundFlowLite[]>([])

const paymentForm = reactive({
  payment_type: 'alipay',
  payment_qrcode: '',
  alipay_id: '',
})

const withdrawOpen = ref(false)
const withdrawForm = reactive({ amount: '' })

function paymentLabel(t: string) {
  if (t === 'wechat') return '微信'
  return '支付宝'
}

function settlementStatusMeta(s: string) {
  switch (s) {
    case 'pending_review': return { label: '待审核', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', dot: 'bg-amber-500' }
    case 'approved': return { label: '已通过', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300', dot: 'bg-sky-500' }
    case 'paid': return { label: '已打款', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', dot: 'bg-emerald-500' }
    case 'rejected': return { label: '已拒绝', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300', dot: 'bg-rose-500' }
    default: return { label: s || '—', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' }
  }
}

function flowTypeMeta(t: string) {
  if (t === 'income') return { label: '收入', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' }
  if (t === 'expense') return { label: '支出', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' }
  if (t === 'fee') return { label: '手续费', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' }
  return { label: t || '—', cls: 'bg-slate-100 text-slate-500' }
}

function flowAmountClass(t: string) {
  if (t === 'income') return 'text-emerald-600 dark:text-emerald-400'
  if (t === 'expense') return 'text-rose-600 dark:text-rose-400'
  if (t === 'fee') return 'text-amber-600 dark:text-amber-400'
  return 'text-slate-700 dark:text-slate-200'
}

function flowAmountDisplay(t: string, a: string) {
  const v = a || '0.00'
  if (t === 'income') return `+¥${v}`
  if (t === 'expense' || t === 'fee') return `-¥${v}`
  return `¥${v}`
}

async function reload() {
  loading.value = true
  try {
    const [w, dc, sk, pi, ss, bal] = await Promise.all([
      getWallet(),
      getDockCode(),
      getSecretKey(),
      getPaymentInfo(),
      getPaymentSettlementRecords({ page: 1, page_size: 5 }),
      getUserBalance(),
    ])
    wallet.value = w
    dockCode.value = dc.dock_code
    secretKey.value = sk.secret_key
    paymentForm.payment_type = pi.payment_type || 'alipay'
    paymentForm.payment_qrcode = pi.payment_qrcode || ''
    paymentForm.alipay_id = pi.alipay_id || ''
    settlements.value = ss.items || []
    recentFlows.value = bal.recent_flows || []
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openWithdraw() {
  withdrawForm.amount = ''
  withdrawOpen.value = true
}

async function submitWithdraw() {
  if (!withdrawForm.amount) {
    toast.error('请输入提现金额')
    return
  }
  withdrawing.value = true
  try {
    const r = await requestWithdraw(withdrawForm.amount)
    toast.success(`提现申请已提交，金额 ¥${r.amount}`)
    withdrawOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '提现失败')
  } finally {
    withdrawing.value = false
  }
}

async function savePayment() {
  if (!paymentForm.payment_qrcode.trim()) {
    toast.error('收款码不能为空')
    return
  }
  savingPayment.value = true
  try {
    await updatePaymentInfo({
      payment_type: paymentForm.payment_type,
      payment_qrcode: paymentForm.payment_qrcode.trim(),
      alipay_id: paymentForm.alipay_id.trim() || undefined,
    })
    toast.success('收款信息已保存')
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    savingPayment.value = false
  }
}

async function resetDockCode() {
  if (!confirm('确认重置对接码？所有绑定与对接记录将被清空，此操作不可撤销。')) return
  resettingCode.value = true
  try {
    const r = await resetDockCodeApi()
    dockCode.value = r.dock_code
    toast.success('对接码已重置')
  } catch (e: any) {
    toast.error(e.message || '重置失败')
  } finally {
    resettingCode.value = false
  }
}

async function resetSecretKey() {
  if (!confirm('确认重置提货秘钥？旧提货链接将立即失效，此操作不可撤销。')) return
  resettingSecret.value = true
  try {
    const r = await resetSecretKeyApi()
    secretKey.value = r.secret_key
    toast.success('提货秘钥已重置')
  } catch (e: any) {
    toast.error(e.message || '重置失败')
  } finally {
    resettingSecret.value = false
  }
}

async function copyText(text: string, msg: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(msg)
  } catch {
    toast.error('复制失败')
  }
}

function onQrError(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(reload)
if (import.meta.client) window.addEventListener('app:refresh', reload)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', reload))
</script>
