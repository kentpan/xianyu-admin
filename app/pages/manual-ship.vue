<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="补发货" description="按订单号查找并标记发货，支持仅状态修改或完整发货" />

    <!-- Search -->
    <div class="card p-5">
      <label class="label">订单号</label>
      <div class="flex items-center gap-2 flex-wrap">
        <div class="relative flex-1 min-w-[240px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" /></span>
          <input
            v-model="orderId"
            class="input pl-9"
            placeholder="输入订单号，回车查询"
            @keyup.enter="search"
          />
        </div>
        <button class="btn-primary" :disabled="searching" @click="search">
          <Icon name="search" v-if="!searching" />
          <Icon name="refresh" v-else class="animate-spin" />
          查询
        </button>
      </div>
    </div>

    <!-- Result -->
    <div v-if="searched && !order" class="card p-10">
      <EmptyState message="未找到对应订单，请检查订单号" icon="orders" />
    </div>

    <div v-if="order" class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div>
          <h3 class="font-semibold text-slate-900 dark:text-white">订单信息</h3>
          <p class="text-xs text-slate-400 font-mono mt-0.5">{{ order.order_id }}</p>
        </div>
        <OrderStatusBadge :status="order.order_status" />
      </div>

      <div class="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div class="space-y-2">
          <div class="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/60">
            <span class="text-slate-400">商品</span>
            <span class="col-span-2 text-slate-800 dark:text-slate-100">{{ order.item_title || order.item_id || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/60">
            <span class="text-slate-400">买家</span>
            <span class="col-span-2">{{ order.buyer_id || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/60">
            <span class="text-slate-400">金额</span>
            <span class="col-span-2 font-medium">¥{{ order.amount || '0' }} × {{ order.quantity || 1 }}</span>
          </div>
          <div v-if="order.spec_value" class="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/60">
            <span class="text-slate-400">规格</span>
            <span class="col-span-2">{{ order.spec_name }}: {{ order.spec_value }}</span>
          </div>
        </div>
        <div class="space-y-2">
          <div class="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/60">
            <span class="text-slate-400">收货人</span>
            <span class="col-span-2">{{ order.receiver_name || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/60">
            <span class="text-slate-400">手机号</span>
            <span class="col-span-2">{{ order.receiver_phone || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/60">
            <span class="text-slate-400">城市</span>
            <span class="col-span-2">{{ order.receiver_city || '—' }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-50 dark:border-slate-700/60">
            <span class="text-slate-400">详细地址</span>
            <span class="col-span-2">{{ order.receiver_address || '—' }}</span>
          </div>
        </div>
      </div>

      <div class="px-5 py-4 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
        <p class="text-sm text-slate-500 dark:text-slate-400 mr-auto">选择发货模式：</p>
        <button class="btn-secondary" :disabled="shipping" @click="ship('status_only')">
          <Icon name="check" v-if="!shipping" />
          <Icon name="refresh" v-else class="animate-spin" />
          仅修改发货状态
        </button>
        <button class="btn-primary" :disabled="shipping" @click="ship('full')">
          <Icon name="truck" v-if="!shipping" />
          <Icon name="refresh" v-else class="animate-spin" />
          完整发货
        </button>
      </div>
    </div>

    <!-- Tip card -->
    <div v-if="!searched" class="card p-6">
      <div class="flex items-start gap-3">
        <div class="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
          <Icon name="info" />
        </div>
        <div class="text-sm">
          <p class="font-medium text-slate-800 dark:text-slate-100">使用说明</p>
          <ul class="mt-1.5 space-y-1 text-slate-500 dark:text-slate-400 list-disc list-inside">
            <li>输入订单号查询对应订单</li>
            <li><b class="text-slate-700 dark:text-slate-200">仅修改发货状态</b>：直接将订单状态改为"已发货"，无需收货信息</li>
            <li><b class="text-slate-700 dark:text-slate-200">完整发货</b>：触发完整发货流程（含物流信息写入）</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()
const toast = useToast()

interface Order {
  order_id: string
  item_id: string | null
  buyer_id: string | null
  spec_name: string | null
  spec_value: string | null
  quantity: string | null
  amount: string | null
  order_status: string
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  receiver_city: string
  item_title?: string | null
}

const orderId = ref('')
const order = ref<Order | null>(null)
const searched = ref(false)
const searching = ref(false)
const shipping = ref(false)

async function search() {
  const id = orderId.value.trim()
  if (!id) {
    toast.warning('请输入订单号')
    return
  }
  searching.value = true
  searched.value = true
  try {
    order.value = await api.get<Order>(`/api/orders/${encodeURIComponent(id)}`)
  } catch (e: any) {
    order.value = null
    if (e.code !== 404) toast.error(e.message || '查询失败')
  } finally {
    searching.value = false
  }
}

async function ship(mode: 'status_only' | 'full') {
  if (!order.value) return
  shipping.value = true
  try {
    await api.post('/api/orders/manual-ship', { order_id: order.value.order_id, mode })
    toast.success(`订单 ${order.value.order_id} 已${mode === 'full' ? '完整发货' : '标记发货'}`)
    order.value.order_status = 'shipped'
  } catch (e: any) {
    toast.error(e.message || '发货失败')
  } finally {
    shipping.value = false
  }
}

// Allow deep-linking: /manual-ship?order_id=O-001
const route = useRoute()
onMounted(() => {
  const qid = route.query.order_id as string
  if (qid) {
    orderId.value = qid
    search()
  }
})
</script>
