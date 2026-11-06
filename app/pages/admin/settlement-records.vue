<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="提现审核" description="审核用户的提现申请，通过 / 拒绝 / 标记已打款">
      <template #actions>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Filters -->
    <div class="card p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <select v-model="statusFilter" class="input !w-auto" @change="goPage(1)">
          <option value="">全部状态</option>
          <option value="pending_review">待审核</option>
          <option value="approved">已通过</option>
          <option value="paid">已打款</option>
          <option value="rejected">已拒绝</option>
        </select>
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input
            v-model="search"
            class="input pl-9"
            placeholder="搜索用户名 / 用户 ID"
            @keyup.enter="goPage(1)"
          />
        </div>
        <p class="text-xs text-slate-400">共 {{ total }} 条</p>
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
                <th>用户</th>
                <th>金额</th>
                <th>方式</th>
                <th>收款码</th>
                <th>状态</th>
                <th>申请时间</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in items" :key="s.id">
                <td>
                  <p class="font-medium text-slate-800 dark:text-white">{{ s.username || `用户 #${s.user_id}` }}</p>
                  <p v-if="s.alipay_id" class="text-xs text-slate-400">{{ s.alipay_id }}</p>
                </td>
                <td><span class="font-semibold tabular-nums text-slate-900 dark:text-white">¥{{ s.amount || '0.00' }}</span></td>
                <td>
                  <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">
                    {{ paymentLabel(s.payment_type) }}
                  </span>
                </td>
                <td>
                  <a v-if="s.payment_qrcode" :href="s.payment_qrcode" target="_blank" class="inline-block">
                    <img :src="s.payment_qrcode" alt="收款码" class="w-12 h-12 rounded border border-slate-200 dark:border-slate-700 object-cover hover:opacity-80 transition-opacity" @error="onQrError" />
                  </a>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td>
                  <span class="badge" :class="statusMeta(s.status).cls">
                    <span class="w-1.5 h-1.5 rounded-full" :class="statusMeta(s.status).dot" />
                    {{ statusMeta(s.status).label }}
                  </span>
                  <p v-if="s.reject_reason" class="text-xs text-rose-500 mt-0.5 max-w-[180px] truncate" :title="s.reject_reason">{{ s.reject_reason }}</p>
                </td>
                <td class="text-slate-500 dark:text-slate-400">{{ formatTime(s.created_at) }}</td>
                <td>
                  <div class="flex items-center justify-end gap-1">
                    <button
                      v-if="s.status === 'pending_review'"
                      class="btn-primary !py-1 !px-2.5 !text-xs"
                      :disabled="acting"
                      @click="approve(s)"
                    >
                      <Icon name="check" /> 通过
                    </button>
                    <button
                      v-if="s.status === 'pending_review' || s.status === 'approved'"
                      class="btn-secondary !py-1 !px-2.5 !text-xs"
                      :disabled="acting"
                      @click="openReject(s)"
                    >
                      <Icon name="close" /> 拒绝
                    </button>
                    <button
                      v-if="s.status === 'approved'"
                      class="btn-secondary !py-1 !px-2.5 !text-xs text-emerald-600"
                      :disabled="acting"
                      @click="markPaid(s)"
                    >
                      <Icon name="packageCheck" /> 标记已打款
                    </button>
                    <span v-if="s.status === 'paid'" class="text-xs text-emerald-600 dark:text-emerald-400">已完结</span>
                    <span v-if="s.status === 'rejected'" class="text-xs text-slate-400">已退款</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-if="!items.length" message="暂无提现申请" icon="wallet" />
      </template>

      <!-- Pagination -->
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

    <!-- Reject modal -->
    <ModalBase v-model="rejectOpen" title="拒绝提现申请" size="sm">
      <div class="space-y-4">
        <div v-if="rejectTarget" class="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-sm">
          <p>用户: <span class="font-medium text-slate-800 dark:text-white">{{ rejectTarget.username || `#${rejectTarget.user_id}` }}</span></p>
          <p>金额: <span class="font-semibold tabular-nums text-rose-600">¥{{ rejectTarget.amount }}</span></p>
          <p class="text-xs text-slate-400 mt-1">拒绝后金额将自动退回用户余额</p>
        </div>
        <div>
          <label class="label">拒绝原因 <span class="text-xs text-slate-400">(可选)</span></label>
          <textarea v-model="rejectForm.reject_reason" rows="3" class="input" placeholder="如 收款码已过期 / 信息有误"></textarea>
        </div>
      </div>
      <template #footer>
        <button class="btn-secondary" @click="rejectOpen = false">取消</button>
        <button class="btn-danger" :disabled="acting" @click="confirmReject">
          <Icon name="refresh" v-if="acting" class="animate-spin" />
          <Icon name="close" v-else />
          确认拒绝并退款
        </button>
      </template>
    </ModalBase>
  </div>
</template>

<script setup lang="ts">
import { getAdminSettlementRecords, approveSettlementRecord, rejectSettlementRecord, markSettlementPaid } from '~/api/admin'
import type { AdminSettlementRecord } from '~/api/admin'

definePageMeta({ layout: 'default' })

const toast = useToast()

const loading = ref(false)
const acting = ref(false)
const items = ref<AdminSettlementRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const search = ref('')
const statusFilter = ref('')

const rejectOpen = ref(false)
const rejectTarget = ref<AdminSettlementRecord | null>(null)
const rejectForm = reactive({ reject_reason: '' })

function paymentLabel(t: string) {
  if (t === 'wechat') return '微信'
  return '支付宝'
}

function statusMeta(s: string) {
  switch (s) {
    case 'pending_review': return { label: '待审核', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', dot: 'bg-amber-500' }
    case 'approved': return { label: '已通过', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300', dot: 'bg-sky-500' }
    case 'paid': return { label: '已打款', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', dot: 'bg-emerald-500' }
    case 'rejected': return { label: '已拒绝', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300', dot: 'bg-rose-500' }
    default: return { label: s || '—', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' }
  }
}

async function reload() {
  loading.value = true
  try {
    const r = await getAdminSettlementRecords({
      page: page.value,
      page_size: pageSize.value,
      status: statusFilter.value || undefined,
      search: search.value.trim() || undefined,
    })
    items.value = r.items || []
    total.value = r.total || 0
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function goPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  reload()
}

async function approve(s: AdminSettlementRecord) {
  if (!confirm(`确认通过 ${s.username || `#${s.user_id}`} 的提现申请 ¥${s.amount}？`)) return
  acting.value = true
  try {
    await approveSettlementRecord(s.id)
    toast.success('已通过审核')
    reload()
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  } finally {
    acting.value = false
  }
}

function openReject(s: AdminSettlementRecord) {
  rejectTarget.value = s
  rejectForm.reject_reason = ''
  rejectOpen.value = true
}

async function confirmReject() {
  if (!rejectTarget.value) return
  acting.value = true
  try {
    await rejectSettlementRecord(rejectTarget.value.id, rejectForm.reject_reason.trim())
    toast.success('已拒绝并退款')
    rejectOpen.value = false
    reload()
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  } finally {
    acting.value = false
  }
}

async function markPaid(s: AdminSettlementRecord) {
  if (!confirm(`确认标记 ${s.username || `#${s.user_id}`} 的提现 ¥${s.amount} 为已打款？`)) return
  acting.value = true
  try {
    await markSettlementPaid(s.id)
    toast.success('已标记为已打款')
    reload()
  } catch (e: any) {
    toast.error(e.message || '操作失败')
  } finally {
    acting.value = false
  }
}

function onQrError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
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
