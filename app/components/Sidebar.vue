<template>
  <!-- Mobile overlay -->
  <div
    class="fixed inset-0 bg-black/60 z-40 sm:hidden transition-opacity"
    :class="mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'"
    @click="mobileOpen = false"
  />
  <aside
    class="fixed top-0 left-0 h-screen z-50 bg-white dark:bg-[#0f172a] flex flex-col border-r border-slate-200 dark:border-slate-800 transition-all duration-200"
    :class="[
      mobileOpen ? 'translate-x-0 w-72' : '-translate-x-full sm:translate-x-0',
      !mobileOpen && (sidebarCollapsed ? 'w-16' : 'w-56'),
    ]"
  >
    <!-- Header -->
    <div
      class="h-14 flex items-center border-b border-slate-200 dark:border-slate-800 shrink-0"
      :class="showLabel ? 'justify-between px-4' : 'justify-center px-2'"
    >
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
          <Icon name="message" class="text-white text-base" />
        </div>
        <span v-if="showLabel" class="font-semibold text-sm text-slate-900 dark:text-white truncate">闲鱼超级管家</span>
      </div>
      <button v-if="mobileOpen" class="sm:hidden p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400" @click="mobileOpen = false">
        <Icon name="x" />
      </button>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto py-3 space-y-0.5 sidebar-scroll" :class="showLabel ? 'px-2' : 'px-1.5'">
      <template v-for="item in mainItems" :key="item.path">
        <SidebarItem :item="item" :show-label="showLabel" :active="isActive(item.path)" @navigate="mobileOpen = false" />
      </template>

      <template v-if="isAdmin">
        <div v-if="showLabel" class="pt-4 pb-2 px-3">
          <p class="text-xs font-medium text-slate-400 uppercase tracking-wider">管理员</p>
        </div>
        <div v-else class="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800" />
        <template v-for="item in adminItems" :key="item.path">
          <SidebarItem :item="item" :show-label="showLabel" :active="isActive(item.path)" @navigate="mobileOpen = false" />
        </template>
      </template>

      <div v-if="showLabel" class="pt-4 pb-2 px-3">
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wider">其他</p>
      </div>
      <div v-else class="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800" />
      <template v-for="item in bottomItems" :key="item.path">
        <SidebarItem :item="item" :show-label="showLabel" :active="isActive(item.path)" @navigate="mobileOpen = false" />
      </template>
    </nav>

    <!-- Collapse toggle (desktop only) -->
    <div class="hidden lg:flex items-center justify-center p-2 border-t border-slate-200 dark:border-slate-800 shrink-0">
      <button
        class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-white"
        :title="sidebarCollapsed ? '展开' : '收起'"
        @click="sidebarCollapsed = !sidebarCollapsed"
      >
        <Icon :name="sidebarCollapsed ? 'panelLeft' : 'panelLeftClose'" />
      </button>
    </div>
  </aside>

  <!-- Mobile menu button -->
  <button
    v-if="!mobileOpen"
    class="fixed top-2.5 left-2.5 z-50 sm:hidden w-9 h-9 rounded-md bg-brand-500 text-white shadow-md flex items-center justify-center active:scale-95 transition-transform"
    @click="mobileOpen = true"
  >
    <Icon name="menu" />
  </button>
</template>

<script setup lang="ts">
import { useNav, type NavItem } from '~/composables/useNav'
import { useAuth } from '~/composables/useAuth'

const { mainItems, adminItems, bottomItems, isActive } = useNav()
const { isAdmin } = useAuth()

const sidebarCollapsed = useState('sidebar_collapsed', () => false)
const mobileOpen = useState('sidebar_mobile_open', () => false)

const showLabel = computed(() => mobileOpen.value || !sidebarCollapsed.value)

// Auto-collapse on medium screens
onMounted(() => {
  const handleResize = () => {
    const w = window.innerWidth
    if (w >= 640 && w < 1024) sidebarCollapsed.value = true
    else if (w >= 1024) sidebarCollapsed.value = false
  }
  handleResize()
  window.addEventListener('resize', handleResize)
  onBeforeUnmount(() => window.removeEventListener('resize', handleResize))
})
</script>
