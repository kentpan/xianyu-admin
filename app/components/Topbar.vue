<template>
  <header class="h-14 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 gap-4">
    <div class="flex items-center gap-3 min-w-0">
      <h1 class="text-base font-semibold text-slate-900 dark:text-white truncate">{{ pageTitle }}</h1>
    </div>
    <div class="flex items-center gap-1 md:gap-2">
      <button
        class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm"
        title="全局搜索 (Ctrl+K)"
        @click="openCmd"
      >
        <Icon name="search" />
        <span class="hidden md:inline">搜索…</span>
        <kbd class="hidden md:inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-700">⌘K</kbd>
      </button>
      <button
        class="sm:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
        title="搜索 (Ctrl+K)"
        @click="openCmd"
      >
        <Icon name="search" />
      </button>
      <button
        class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
        title="刷新"
        @click="refresh"
      >
        <Icon name="refresh" :class="refreshing ? 'animate-spin' : ''" />
      </button>
      <button
        class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
        :title="colorMode === 'dark' ? '切换浅色' : '切换深色'"
        @click="toggleColorMode"
      >
        <Icon :name="colorMode === 'dark' ? 'sun' : 'moon'" />
      </button>
      <ThemeSwitcher />
      <button
        class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
        title="快捷键 (?)"
        @click="shortcutOpen = true"
      >
        <Icon name="shield" />
      </button>
      <NotificationBell />
      <div class="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 flex items-center justify-center text-sm font-semibold">
          {{ initial }}
        </div>
        <div class="hidden md:block leading-tight">
          <p class="text-sm font-medium text-slate-800 dark:text-slate-100">{{ user?.username || '用户' }}</p>
          <p class="text-xs text-slate-400">{{ user?.is_admin ? '管理员' : '普通用户' }}</p>
        </div>
      </div>
      <button
        class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
        title="退出登录"
        @click="handleLogout"
      >
        <Icon name="logout" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'

const { user, logout } = useAuth()
const toast = useToast()
const router = useRouter()
const route = useRoute()

const refreshing = ref(false)
const initial = computed(() => (user.value?.username?.[0] || 'U').toUpperCase())

// Command palette — shared state with layout
const cmdOpen = useState<boolean>('cmd_open', () => false)
function openCmd() { cmdOpen.value = true }

// Shortcut help — shared state with layout
const shortcutOpen = useState<boolean>('shortcut_open', () => false)

const colorMode = inject<{ value: 'light' | 'dark' }>('colorMode', { value: 'light' })
const toggleColorMode = () => {
  colorMode.value = colorMode.value === 'dark' ? 'light' : 'dark'
}

const pageTitle = computed(() => {
  const map: Record<string, string> = {
    '/dashboard': '工作台',
    '/accounts': '账号管理',
    '/items': '商品管理',
    '/orders': '订单管理',
    '/manual-ship': '补发货',
    '/keywords': '自动回复',
    '/item-replies': '指定商品回复',
    '/cards': '卡券管理',
    '/delivery': '自动发货',
    '/notification-channels': '通知渠道',
    '/message-notifications': '消息通知',
    '/settings': '系统设置',
    '/admin/users': '用户管理',
    '/admin/logs': '系统日志',
    '/admin/risk-logs': '风控日志',
    '/admin/data': '数据管理',
    '/disclaimer': '免责声明',
    '/about': '关于',
  }
  return map[route.path] || '闲鱼超级管家'
})

function refresh() {
  refreshing.value = true
  setTimeout(() => (refreshing.value = false), 600)
  // Emit a global event that pages can listen to for reloading data
  if (import.meta.client) window.dispatchEvent(new CustomEvent('app:refresh'))
}

async function handleLogout() {
  await logout()
  toast.success('已退出登录')
  router.push('/login')
}
</script>
