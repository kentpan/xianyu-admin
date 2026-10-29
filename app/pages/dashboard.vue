<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="工作台" description="数据概览与快捷操作">
      <template #actions>
        <button class="btn-secondary" @click="openReport">
          <Icon name="download" /> 导出报告
        </button>
        <button class="btn-secondary" @click="reload">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> 刷新
        </button>
      </template>
    </PageHeader>

    <!-- Stat cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard label="闲鱼账号" :value="stats.totalAccounts" icon="accounts" color="amber" :hint="`活跃 ${stats.activeAccounts}`" />
      <StatCard label="自动回复关键词" :value="stats.totalKeywords" icon="keywords" color="sky" />
      <StatCard label="订单总数" :value="stats.totalOrders" icon="orders" color="emerald" />
      <StatCard label="商品数量" :value="stats.totalItems" icon="items" color="slate" />
    </div>

    <!-- Data comparison -->
    <ComparisonCard v-if="comparisonData" :data="comparisonData" />

    <!-- Account online status panel -->
    <div v-if="onlineStatus.items.length" class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <h3 class="font-semibold text-slate-900 dark:text-white">账号在线状态</h3>
          <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {{ onlineStatus.summary.online }} 在线
          </span>
          <span v-if="onlineStatus.summary.offline" class="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{{ onlineStatus.summary.offline }} 离线</span>
          <span v-if="onlineStatus.summary.disabled" class="badge bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400">{{ onlineStatus.summary.disabled }} 停用</span>
        </div>
        <NuxtLink to="/accounts" class="text-xs text-brand-600 hover:underline flex items-center gap-1">管理 <Icon name="arrowRight" /></NuxtLink>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div v-for="a in onlineStatus.items.slice(0, 6)" :key="a.id" class="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
          <span class="relative shrink-0">
            <span class="w-2.5 h-2.5 rounded-full" :class="a.isOnline ? 'bg-emerald-500' : a.enabled ? 'bg-amber-400' : 'bg-slate-300'" />
            <span v-if="a.isOnline" class="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{{ a.remark }}</p>
            <p class="text-xs text-slate-400">{{ a.orderCount }} 订单 · {{ a.keywordCount }} 关键词</p>
          </div>
          <span class="text-xs shrink-0" :class="a.isOnline ? 'text-emerald-600 dark:text-emerald-400' : a.enabled ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'">
            {{ a.isOnline ? '在线' : a.enabled ? '离线' : '停用' }}
          </span>
        </div>
      </div>
    </div>

    <!-- 7-day order trend -->
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="font-semibold text-slate-900 dark:text-white">7 天订单趋势</h3>
          <p class="text-xs text-slate-400 mt-0.5">近 7 天订单量与收入</p>
        </div>
        <div class="flex items-center gap-4 text-right">
          <div>
            <p class="text-xs text-slate-400">7天订单</p>
            <p class="text-lg font-semibold text-slate-900 dark:text-white tabular-nums">{{ trend.totalOrders }}</p>
          </div>
          <div>
            <p class="text-xs text-slate-400">7天收入</p>
            <p class="text-lg font-semibold text-emerald-600 tabular-nums">¥{{ trend.totalRevenue.toFixed(2) }}</p>
          </div>
          <button v-if="trend.days.length" class="btn-ghost !px-2 !py-1" title="导出为PNG" @click="exportTrendChart">
            <Icon name="download" />
          </button>
        </div>
      </div>
      <div v-if="trend.days.length" class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p class="text-xs text-slate-400 mb-1 flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-brand-500" /> 订单量</p>
          <LineChart :data="trend.days.map(d => d.count)" :labels="trend.days.map(d => d.label)" color="#f59e0b" unit="单" />
        </div>
        <div>
          <p class="text-xs text-slate-400 mb-1 flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500" /> 收入(¥)</p>
          <LineChart :data="trend.days.map(d => d.revenue)" :labels="trend.days.map(d => d.label)" color="#10b981" unit="元" />
        </div>
      </div>
      <EmptyState v-else message="暂无趋势数据" icon="activity" />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- Order status distribution — donut chart + legend -->
      <div class="card p-5 lg:col-span-2">
        <div class="flex items-center justify-between mb-5">
          <h3 class="font-semibold text-slate-900 dark:text-white">订单状态分布</h3>
          <div class="flex items-center gap-2">
            <button v-if="statusBars.length" class="btn-ghost !px-2 !py-1" title="导出环形图" @click="exportDonutChart">
              <Icon name="download" />
            </button>
            <span class="badge bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
              <Icon name="activity" /> 实时
            </span>
          </div>
        </div>
        <div v-if="statusBars.length" class="grid grid-cols-1 md:grid-cols-5 gap-6 items-center">
          <div class="md:col-span-2 flex justify-center">
            <DonutChart :data="donutData" :size="180" :stroke-width="22" center-label="订单" />
          </div>
          <div class="md:col-span-3 space-y-2.5">
            <div v-for="s in statusBars" :key="s.key" class="flex items-center gap-3">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="s.color" />
              <span class="flex-1 text-sm text-slate-600 dark:text-slate-300 truncate">{{ s.label }}</span>
              <div class="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden max-w-[100px]">
                <div class="h-full rounded-full transition-all duration-500" :class="s.color" :style="{ width: s.pct + '%' }" />
              </div>
              <span class="w-8 text-right text-sm font-medium text-slate-700 dark:text-slate-200 tabular-nums">{{ s.count }}</span>
            </div>
          </div>
        </div>
        <EmptyState v-else message="暂无订单数据" icon="orders" />
      </div>

      <!-- Quick actions -->
      <div class="card p-5">
        <h3 class="font-semibold text-slate-900 dark:text-white mb-4">快捷操作</h3>
        <div class="grid grid-cols-2 gap-2">
          <NuxtLink v-for="a in quickActions" :key="a.path" :to="a.path" class="group rounded-lg border border-slate-200 dark:border-slate-700 p-3 hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/10 transition-all hover:shadow-sm">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center mb-2 transition-transform group-hover:scale-110" :class="a.bg">
              <Icon :name="a.icon" :class="a.text" />
            </div>
            <p class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ a.label }}</p>
          </NuxtLink>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Recent orders -->
      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h3 class="font-semibold text-slate-900 dark:text-white">最近订单</h3>
          <NuxtLink to="/orders" class="text-xs text-brand-600 hover:underline flex items-center gap-1">查看全部 <Icon name="arrowRight" /></NuxtLink>
        </div>
        <div v-if="stats.recentOrders?.length" class="divide-y divide-slate-100 dark:divide-slate-700">
          <div v-for="o in stats.recentOrders" :key="o.order_id" class="px-5 py-3 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{{ o.order_id }}</p>
              <p class="text-xs text-slate-400 mt-0.5">买家 {{ o.buyer_id || '—' }} · {{ formatTime(o.created_at) }}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-sm font-semibold text-slate-700 dark:text-slate-200">¥{{ o.amount || '0' }}</p>
              <OrderStatusBadge :status="o.order_status" />
            </div>
          </div>
        </div>
        <EmptyState v-else message="暂无订单" icon="orders" />
      </div>

      <!-- Recent logs -->
      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h3 class="font-semibold text-slate-900 dark:text-white">系统动态</h3>
          <NuxtLink to="/admin/logs" class="text-xs text-brand-600 hover:underline flex items-center gap-1">更多 <Icon name="arrowRight" /></NuxtLink>
        </div>
        <div v-if="stats.recentLogs?.length" class="divide-y divide-slate-100 dark:divide-slate-700 max-h-80 overflow-y-auto scrollbar-thin">
          <div v-for="l in stats.recentLogs" :key="l.id" class="px-5 py-3 flex items-start gap-3">
            <span class="mt-1 w-2 h-2 rounded-full shrink-0" :class="logDotClass(l.level)" />
            <div class="min-w-0 flex-1">
              <p class="text-sm text-slate-700 dark:text-slate-200">{{ l.message }}</p>
              <p class="text-xs text-slate-400 mt-0.5">{{ l.module || 'system' }} · {{ formatTime(l.created_at) }}</p>
            </div>
          </div>
        </div>
        <EmptyState v-else message="暂无日志" icon="logs" />
      </div>
    </div>

    <!-- System health panel -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="card p-5">
        <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Icon name="server" class="text-brand-500" /> 系统健康
        </h3>
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-500">运行时长</span>
            <span class="text-sm font-medium text-slate-800 dark:text-slate-100">{{ health.uptimeLabel }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-500">Node 版本</span>
            <span class="text-sm font-medium text-slate-800 dark:text-slate-100">{{ health.nodeVersion }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-500">服务状态</span>
            <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> 在线
            </span>
          </div>
        </div>
      </div>

      <div class="card p-5">
        <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Icon name="activity" class="text-sky-500" /> 内存使用
        </h3>
        <div class="space-y-3">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm text-slate-500">堆内存</span>
              <span class="text-sm font-medium text-slate-800 dark:text-slate-100 tabular-nums">{{ health.memory.heapUsedLabel }} / {{ health.memory.heapTotalLabel }}</span>
            </div>
            <div class="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500" :class="health.memory.heapPercent > 80 ? 'bg-rose-500' : health.memory.heapPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500'" :style="{ width: health.memory.heapPercent + '%' }" />
            </div>
            <p class="text-xs text-slate-400 mt-1">{{ health.memory.heapPercent }}% 使用率</p>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-500">RSS 总量</span>
            <span class="text-sm font-medium text-slate-800 dark:text-slate-100 tabular-nums">{{ health.memory.rssLabel }}</span>
          </div>
        </div>
      </div>

      <div class="card p-5">
        <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Icon name="database" class="text-emerald-500" /> 数据库
        </h3>
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-500">驱动</span>
            <span class="badge bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{{ (health.db.driver || 'sqlite').toUpperCase() }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-500">数据库大小</span>
            <span class="text-sm font-medium text-slate-800 dark:text-slate-100 tabular-nums">{{ health.db.sizeLabel }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-500">表数量</span>
            <span class="text-sm font-medium text-slate-800 dark:text-slate-100 tabular-nums">{{ health.db.tableCount }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-500">总记录数</span>
            <span class="text-sm font-medium text-slate-800 dark:text-slate-100 tabular-nums">{{ health.db.totalRows.toLocaleString() }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Live activity stream -->
    <div class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h3 class="font-semibold text-slate-900 dark:text-white">实时活动流</h3>
          <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> 实时
          </span>
        </div>
        <button class="text-xs text-brand-600 hover:underline flex items-center gap-1" @click="loadActivity">
          <Icon name="refresh" :class="activityLoading ? 'animate-spin' : ''" /> 刷新
        </button>
      </div>
      <div v-if="activities.length" class="divide-y divide-slate-100 dark:divide-slate-700 max-h-[400px] overflow-y-auto scrollbar-thin">
        <div v-for="a in activities" :key="a.id" class="px-5 py-3 flex items-start gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :class="a.color">
            <Icon :name="a.icon" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{{ a.title }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{{ a.desc }}</p>
          </div>
          <span class="text-xs text-slate-400 shrink-0 whitespace-nowrap">{{ relativeTime(a.ts) }}</span>
        </div>
      </div>
      <EmptyState v-else message="暂无活动" icon="activity" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { getDashboardStats, getDashboardTrend, getDashboardHealth, getDashboardOnline, getDashboardComparison, getDashboardActivity, getDashboardReportUrl } from '~/api/dashboard'
import type { DashboardStats, TrendDay, ActivityItem, OnlineAccount } from '~/api/dashboard'

definePageMeta({ layout: 'default' })

const loading = ref(false)

const stats = ref<DashboardStats>({
  totalAccounts: 0, activeAccounts: 0, totalKeywords: 0, totalOrders: 0,
  totalItems: 0, totalCards: 0, totalChannels: 0,
  orderStatusDist: {}, recentOrders: [], recentLogs: [],
})

const trend = ref<{ days: TrendDay[]; totalOrders: number; totalRevenue: number }>({
  days: [], totalOrders: 0, totalRevenue: 0,
})

const activities = ref<ActivityItem[]>([])
const activityLoading = ref(false)

const onlineStatus = ref<{ items: OnlineAccount[]; summary: { total: number; online: number; offline: number; disabled: number } }>({
  items: [],
  summary: { total: 0, online: 0, offline: 0, disabled: 0 },
})

async function loadOnlineStatus() {
  try {
    const data = await getDashboardOnline()
    onlineStatus.value = data
  } catch {
    // silent
  }
}

// System health
const health = ref<any>({
  uptimeLabel: '—', nodeVersion: '—', memory: { heapUsedLabel: '—', heapTotalLabel: '—', rssLabel: '—', heapPercent: 0 },
  db: { driver: 'sqlite', sizeLabel: '—', tableCount: 0, totalRows: 0 },
})
async function loadHealth() {
  try {
    health.value = await getDashboardHealth()
  } catch {
    // silent
  }
}

// Chart export
const { exportSvgToPng } = useChartExport()
async function exportTrendChart() {
  const svgs = document.querySelectorAll('.card svg')
  if (svgs.length) {
    try {
      await exportSvgToPng(svgs[0] as HTMLElement, `order_trend_${Date.now()}.png`)
    } catch {
      // silent
    }
  }
}

// Data comparison
const comparisonData = ref<any>(null)
async function loadComparison() {
  try {
    comparisonData.value = await getDashboardComparison()
  } catch {
    // silent
  }
}

// PDF report
function openReport() {
  window.open(getDashboardReportUrl(), '_blank')
}

// Donut chart export
async function exportDonutChart() {
  const svgs = document.querySelectorAll('.card svg')
  if (svgs.length > 1) {
    try {
      await exportSvgToPng(svgs[1] as HTMLElement, `order_status_${Date.now()}.png`)
    } catch {
      // silent
    }
  }
}

async function loadActivity() {
  activityLoading.value = true
  try {
    const data = await getDashboardActivity()
    activities.value = data.activities || []
  } catch {
    // silent
  } finally {
    activityLoading.value = false
  }
}

function relativeTime(ts: number): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return Math.floor(diff / 86400000) + '天前'
}

const STATUS_META: Record<string, { label: string; color: string; hex: string }> = {
  pending_ship: { label: '待发货', color: 'bg-amber-500', hex: '#f59e0b' },
  shipped: { label: '已发货', color: 'bg-sky-500', hex: '#0ea5e9' },
  completed: { label: '已完成', color: 'bg-emerald-500', hex: '#10b981' },
  cancelled: { label: '已取消', color: 'bg-slate-400', hex: '#94a3b8' },
  refunding: { label: '退款中', color: 'bg-rose-500', hex: '#f43f5e' },
  processing: { label: '处理中', color: 'bg-brand-500', hex: '#f59e0b' },
  unknown: { label: '未知', color: 'bg-slate-300', hex: '#cbd5e1' },
}

const statusBars = computed(() => {
  const dist = stats.value.orderStatusDist || {}
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1
  return Object.entries(dist).map(([key, count]) => {
    const meta = STATUS_META[key] || STATUS_META.unknown
    return { key, label: meta.label, color: meta.color, count, pct: Math.round((count / total) * 100) }
  }).sort((a, b) => b.count - a.count)
})

// Hex colors for the donut chart (SVG stroke needs hex, not tailwind classes)
const donutData = computed(() =>
  statusBars.value.map((s) => {
    const meta = STATUS_META[s.key] || STATUS_META.unknown
    return { key: s.key, label: s.label, value: s.count, color: meta.hex }
  }),
)

const quickActions = [
  { label: '账号管理', path: '/accounts', icon: 'accounts', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  { label: '查看订单', path: '/orders', icon: 'orders', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  { label: '配置回复', path: '/keywords', icon: 'keywords', bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-600 dark:text-sky-400' },
  { label: '卡券管理', path: '/cards', icon: 'cards', bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-400' },
  { label: '自动发货', path: '/delivery', icon: 'delivery', bg: 'bg-slate-100 dark:bg-slate-700/40', text: 'text-slate-600 dark:text-slate-300' },
  { label: '系统设置', path: '/settings', icon: 'settings', bg: 'bg-brand-100 dark:bg-brand-900/30', text: 'text-brand-600 dark:text-brand-400' },
]

async function reload() {
  loading.value = true
  try {
    const [data, trendData] = await Promise.all([
      getDashboardStats(),
      getDashboardTrend(),
    ])
    stats.value = data
    trend.value = trendData
    loadActivity() // fire & forget
    loadOnlineStatus() // fire & forget
    loadHealth() // fire & forget
    loadComparison() // fire & forget
  } catch (e: any) {
    // silent on dashboard
  } finally {
    loading.value = false
  }
}

function formatTime(t?: string) {
  if (!t) return '—'
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function logDotClass(level: string) {
  return {
    INFO: 'bg-sky-400', WARN: 'bg-amber-400', ERROR: 'bg-red-500', DEBUG: 'bg-slate-400',
  }[level] || 'bg-slate-400'
}

// Auto-refresh activity stream every 30s
let _activityTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  reload()
  if (import.meta.client) {
    window.addEventListener('app:refresh', reload)
    _activityTimer = setInterval(() => {
      loadActivity()
      loadOnlineStatus()
    }, 30000)
  }
})
onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener('app:refresh', reload)
    if (_activityTimer) clearInterval(_activityTimer)
  }
})
</script>
