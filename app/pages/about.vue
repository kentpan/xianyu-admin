<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="关于" description="闲鱼超级管家 · 开源学习项目" />

    <!-- Hero -->
    <div class="card p-6 md:p-8 text-center relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br from-brand-50 via-transparent to-transparent dark:from-brand-900/20" />
      <div class="relative">
        <div class="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white shadow-lg shadow-brand-500/30 mb-3">
          <Icon name="message" class="text-3xl" />
        </div>
        <h2 class="text-2xl font-bold text-slate-900 dark:text-white">{{ appName }}</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Xianyu Super Butler · v{{ version }}</p>
        <div class="mt-3 flex items-center justify-center gap-2 flex-wrap">
          <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Icon name="check" /> 开源</span>
          <span class="badge bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"><Icon name="info" /> 仅供学习研究</span>
          <span class="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><Icon name="alert" /> 严禁商业用途</span>
        </div>
      </div>
    </div>

    <!-- Live project metrics -->
    <div>
      <h3 class="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Icon name="activity" class="text-brand-500" /> 实时项目指标
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="用户" :value="metrics.users" icon="users" color="amber" hint="注册用户数" />
        <StatCard label="闲鱼账号" :value="metrics.accounts" icon="accounts" color="emerald" hint="已录入账号" />
        <StatCard label="订单" :value="metrics.orders" icon="orders" color="sky" hint="累计订单" />
        <StatCard label="商品" :value="metrics.items" icon="items" color="rose" hint="商品记录" />
        <StatCard label="关键词" :value="metrics.keywords" icon="keywords" color="slate" hint="自动回复规则" />
        <StatCard label="卡券" :value="metrics.cards" icon="cards" color="amber" hint="卡券库存" />
        <StatCard label="通知渠道" :value="metrics.channels" icon="channels" color="emerald" hint="已配置渠道" />
        <StatCard label="数据库表" :value="metrics.tableCount" icon="database" color="sky" hint="数据表数量" />
      </div>
    </div>

    <!-- System info -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <!-- Runtime status -->
      <div class="card p-5 lg:col-span-1">
        <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Icon name="server" class="text-brand-500" /> 运行状态
        </h3>
        <div class="space-y-3">
          <InfoRow label="数据库驱动" :value="(metrics.driver || 'sqlite').toUpperCase()" icon="database" />
          <InfoRow label="运行时长" :value="formatUptime(metrics.uptime)" icon="clock" />
          <InfoRow label="系统日志" :value="String(metrics.logs)" icon="logs" />
          <InfoRow label="系统设置" :value="String(metrics.settings)" icon="settings" />
          <div class="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
            <span class="text-sm text-slate-500">服务状态</span>
            <span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> 在线
            </span>
          </div>
        </div>
      </div>

      <!-- Tech stack -->
      <div class="card p-5 lg:col-span-2">
        <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Icon name="server" class="text-brand-500" /> 技术栈
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div v-for="t in techStack" :key="t.label" class="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
            <div class="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 shrink-0 shadow-sm">
              <Icon :name="t.icon" />
            </div>
            <div class="min-w-0">
              <p class="text-xs text-slate-400">{{ t.label }}</p>
              <p class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{{ t.value }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Features -->
    <div class="card p-5">
      <h3 class="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
        <Icon name="check" class="text-brand-500" /> 功能特性
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <div v-for="f in features" :key="f" class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <span class="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center shrink-0">
            <Icon name="check" />
          </span>
          <span>{{ f }}</span>
        </div>
      </div>
    </div>

    <!-- Links & disclaimer -->
    <div class="card p-5 space-y-3">
      <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
        <Icon name="info" class="text-brand-500" /> 链接与声明
      </h3>
      <div class="flex items-center gap-2 flex-wrap">
        <a href="https://github.com/Mxucc/xianyu-super-butler" target="_blank" rel="noopener noreferrer" class="btn-secondary">
          <Icon name="external" /> 源项目仓库
        </a>
        <NuxtLink to="/disclaimer" class="btn-secondary">
          <Icon name="disclaimer" /> 免责声明
        </NuxtLink>
        <NuxtLink to="/dashboard" class="btn-primary">
          <Icon name="dashboard" /> 返回工作台
        </NuxtLink>
      </div>
      <div class="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 p-3 text-xs text-amber-700 dark:text-amber-300">
        本项目为对原 xianyu-super-butler 项目的 Nuxt 4 + Tailwind 3.4.19 技术栈复刻，仅供学习研究使用。使用者需自行承担一切后果，详见免责声明。
      </div>
      <p class="text-xs text-slate-400 text-center pt-2">© {{ year }} {{ appName }} · Made with Nuxt & Tailwind</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'

definePageMeta({ layout: 'default' })

const api = useApi()

const version = ref('1.0.0')
const appName = ref('闲鱼超级管家')

interface ProjectMetrics {
  users: number
  accounts: number
  orders: number
  items: number
  keywords: number
  cards: number
  deliveryRules: number
  channels: number
  settings: number
  logs: number
  tableCount: number
  driver: string
  appName: string
  appVersion: string
  uptime: number
}

const metrics = ref<ProjectMetrics>({
  users: 0, accounts: 0, orders: 0, items: 0, keywords: 0, cards: 0,
  deliveryRules: 0, channels: 0, settings: 0, logs: 0, tableCount: 0,
  driver: 'sqlite', appName: '', appVersion: '', uptime: 0,
})

const techStack = [
  { label: '前端框架', value: 'Nuxt 4.4.8 (Vue 3)', icon: 'server' },
  { label: 'UI 框架', value: 'Tailwind CSS 3.4.19', icon: 'package' },
  { label: '运行时', value: 'Nitro / Node.js', icon: 'activity' },
  { label: '数据库', value: 'SQLite / MySQL / D1 / Memory', icon: 'database' },
  { label: '认证', value: 'JWT + bcrypt', icon: 'lock' },
  { label: '语言', value: 'TypeScript', icon: 'edit' },
]

const features = [
  '账号 Cookie 管理', '商品与订单同步', '关键词自动回复', 'AI 智能议价',
  '多类型卡券', '自动发货规则', '多渠道消息通知', '风控日志追踪',
  '系统设置面板', '管理员后台', '数据备份导入导出', '多数据库驱动',
  '面包屑导航', '侧滑详情抽屉', '环形图可视化', '骨架屏加载',
]

const year = new Date().getFullYear()

function formatUptime(s: number): string {
  if (!s) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}小时${m}分`
  return `${m}分钟`
}

// Inline InfoRow component
const InfoRow = defineComponent({
  props: { label: String, value: String, icon: String },
  setup(p) {
    return () => h('div', { class: 'flex items-center justify-between gap-2' }, [
      h('span', { class: 'text-sm text-slate-500 flex items-center gap-1.5' }, [
        h(resolveComponent('Icon'), { name: (p.icon as string) || 'info', class: 'text-slate-400' }),
        p.label,
      ]),
      h('span', { class: 'text-sm font-medium text-slate-800 dark:text-slate-100' }, p.value),
    ])
  },
})

async function loadMetrics() {
  try {
    const r = await api.get<ProjectMetrics>('/api/about/stats')
    metrics.value = r
    if (r.appName) appName.value = r.appName
    if (r.appVersion) version.value = r.appVersion
  } catch {
    // silent
  }
}

onMounted(loadMetrics)
if (import.meta.client) window.addEventListener('app:refresh', loadMetrics)
onBeforeUnmount(() => import.meta.client && window.removeEventListener('app:refresh', loadMetrics))
</script>
