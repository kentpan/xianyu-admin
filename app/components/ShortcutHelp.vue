<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="fixed inset-0 z-[98] flex items-center justify-center p-4" @click.self="close">
        <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
        <div class="modal-panel relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h3 class="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Icon name="shield" class="text-brand-500" /> 键盘快捷键
            </h3>
            <button class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" @click="close">
              <Icon name="x" />
            </button>
          </div>
          <!-- Body -->
          <div class="p-5 space-y-4 max-h-[60vh] overflow-y-auto scrollbar-thin">
            <div v-for="group in groups" :key="group.title">
              <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{{ group.title }}</p>
              <div class="space-y-2">
                <div v-for="s in group.items" :key="s.keys" class="flex items-center justify-between gap-3 py-1.5">
                  <span class="text-sm text-slate-600 dark:text-slate-300">{{ s.label }}</span>
                  <div class="flex items-center gap-1 shrink-0">
                    <kbd v-for="(k, i) in s.keys" :key="i" class="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600">{{ k }}</kbd>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- Footer -->
          <div class="px-5 py-3 border-t border-slate-100 dark:border-slate-700 text-center">
            <p class="text-xs text-slate-400">按 <kbd class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-xs">Esc</kbd> 或 <kbd class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-xs">?</kbd> 关闭</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const open = defineModel<boolean>({ default: false })

function close() { open.value = false }

const groups = [
  {
    title: '全局',
    items: [
      { label: '打开命令面板', keys: ['Ctrl', 'K'] },
      { label: '查看快捷键帮助', keys: ['?'] },
      { label: '关闭弹窗/面板', keys: ['Esc'] },
      { label: '刷新当前页数据', keys: ['Ctrl', 'R'] },
    ],
  },
  {
    title: '导航',
    items: [
      { label: '工作台', keys: ['g', 'd'] },
      { label: '账号管理', keys: ['g', 'a'] },
      { label: '订单管理', keys: ['g', 'o'] },
      { label: '系统设置', keys: ['g', 's'] },
    ],
  },
  {
    title: '操作',
    items: [
      { label: '新增（当前页）', keys: ['n'] },
      { label: '搜索/筛选', keys: ['/'] },
      { label: '切换深色/浅色', keys: ['Ctrl', 'D'] },
    ],
  },
]

// Global ? key listener
onMounted(() => {
  if (import.meta.client) {
    window.addEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener('keydown', onKey)
  }
})
function onKey(e: KeyboardEvent) {
  // ? key (Shift+/) — but only when not typing in an input
  if (e.key === '?' && !isTyping(e.target)) {
    e.preventDefault()
    open.value = !open.value
  }
  if (e.key === 'Escape' && open.value) {
    close()
  }
}
function isTyping(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}
</script>
