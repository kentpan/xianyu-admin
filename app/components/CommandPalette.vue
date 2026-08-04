<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="fixed inset-0 z-[95] flex items-start justify-center pt-[12vh] p-4" @click.self="close">
        <div class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
        <div class="modal-panel relative w-full max-w-xl bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <!-- Search input -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <Icon name="search" class="text-slate-400 text-lg shrink-0" />
            <input
              ref="inputRef"
              v-model="query"
              class="flex-1 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 outline-none text-sm"
              placeholder="搜索页面或操作… (Esc 关闭)"
              @keydown.down.prevent="moveDown"
              @keydown.up.prevent="moveUp"
              @keydown.enter.prevent="selectActive"
            />
            <kbd class="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-slate-400 bg-slate-100 dark:bg-slate-700">ESC</kbd>
          </div>
          <!-- Results -->
          <div class="max-h-[50vh] overflow-y-auto scrollbar-thin p-2">
            <p v-if="!filtered.length" class="text-center text-sm text-slate-400 py-8">没有匹配的结果</p>
            <template v-for="(group, gi) in grouped" :key="group.title">
              <p v-if="group.items.length" class="px-2 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">{{ group.title }}</p>
              <button
                v-for="(item, i) in group.items"
                :key="item.id"
                class="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors"
                :class="activeIndex === flatIndex(gi, i) ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200'"
                @click="run(item)"
                @mouseenter="activeIndex = flatIndex(gi, i)"
              >
                <span class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :class="activeIndex === flatIndex(gi, i) ? 'bg-brand-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'">
                  <Icon :name="item.icon" />
                </span>
                <span class="flex-1 min-w-0">
                  <span class="block text-sm font-medium truncate">{{ item.label }}</span>
                  <span v-if="item.hint" class="block text-xs text-slate-400 truncate">{{ item.hint }}</span>
                </span>
                <Icon v-if="item.type === 'page'" name="arrowRight" class="text-slate-300 text-xs shrink-0" />
              </button>
            </template>
          </div>
          <!-- Footer -->
          <div class="px-4 py-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-400">
            <span class="flex items-center gap-2">
              <kbd class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700">↑↓</kbd> 导航
              <kbd class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700">↵</kbd> 选择
            </span>
            <span>闲鱼超级管家</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { NAV_ITEMS } from '~/composables/useNav'

const open = defineModel<boolean>({ default: false })
const router = useRouter()
const toast = useToast()

interface CmdItem {
  id: string
  label: string
  hint?: string
  icon: string
  type: 'page' | 'action'
  action?: () => void
  to?: string
}

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

// Build command list from NAV_ITEMS (single source of truth) + actions
const allItems = computed<CmdItem[]>(() => {
  const pages: CmdItem[] = NAV_ITEMS.map((n) => ({
    id: `page-${n.path}`,
    label: n.label,
    hint: n.path,
    icon: n.icon,
    type: 'page' as const,
    to: n.path,
  }))
  const actions: CmdItem[] = [
    { id: 'act-refresh', label: '刷新当前页数据', icon: 'refresh', type: 'action', action: () => { if (import.meta.client) window.dispatchEvent(new CustomEvent('app:refresh')); toast.success('已刷新') } },
    { id: 'act-dark', label: '切换深色/浅色模式', icon: 'moon', type: 'action', action: () => { if (import.meta.client) { const cur = document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark'); localStorage.setItem('color_mode', cur ? 'light' : 'dark') } } },
    { id: 'act-logout', label: '退出登录', icon: 'logout', type: 'action', action: async () => { const { logout } = useAuth(); await logout(); router.push('/login') } },
  ]
  return [...pages, ...actions]
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return allItems.value
  return allItems.value.filter((i) => i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q))
})

const grouped = computed(() => [
  { title: '页面', items: filtered.value.filter((i) => i.type === 'page') },
  { title: '操作', items: filtered.value.filter((i) => i.type === 'action') },
])

function flatIndex(gi: number, ii: number): number {
  let n = 0
  for (let g = 0; g < gi; g++) n += grouped.value[g].items.length
  return n + ii
}

function moveDown() {
  if (activeIndex.value < filtered.value.length - 1) activeIndex.value++
}
function moveUp() {
  if (activeIndex.value > 0) activeIndex.value--
}
function selectActive() {
  const item = filtered.value[activeIndex.value]
  if (item) run(item)
}
function run(item: CmdItem) {
  close()
  if (item.type === 'page' && item.to) {
    router.push(item.to)
  } else if (item.type === 'action' && item.action) {
    item.action()
  }
}
function close() {
  open.value = false
  query.value = ''
  activeIndex.value = 0
}

// Focus input when open
watch(open, (v) => {
  if (v) {
    nextTick(() => inputRef.value?.focus())
  } else {
    query.value = ''
    activeIndex.value = 0
  }
})

// Global Cmd+K / Ctrl+K listener (mounted in layout)
onMounted(() => {
  if (import.meta.client) {
    window.addEventListener('keydown', onGlobalKey)
  }
})
onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener('keydown', onGlobalKey)
  }
})
function onGlobalKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    open.value = !open.value
  }
  if (e.key === 'Escape' && open.value) {
    close()
  }
}

// Reset active index when query changes
watch(query, () => { activeIndex.value = 0 })
</script>
