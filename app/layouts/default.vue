<template>
  <div class="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0b1120]">
    <Sidebar />
    <div
      class="flex-1 flex flex-col min-w-0 transition-all duration-200"
      :class="sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56'"
    >
      <Topbar />
      <main class="flex-1 p-4 md:p-6 max-w-full overflow-x-hidden">
        <Breadcrumb :items="breadcrumbItems" />
        <slot />
      </main>
    </div>
    <!-- Page-level loading indicator (top bar) -->
    <div
      v-if="nuxtLoading"
      class="fixed top-0 left-0 right-0 h-0.5 z-[60] bg-brand-500 origin-left"
      style="animation: loadingbar 1.2s ease-in-out infinite;"
    />
    <!-- Global command palette (Cmd/Ctrl+K) -->
    <CommandPalette v-model="cmdOpen" />
    <!-- Keyboard shortcut help (? key) -->
    <ShortcutHelp v-model="shortcutOpen" />
    <!-- 风控人工验证全局弹窗 (token 连败 ≥3 次自动弹出) -->
    <VerifySliderModal />
  </div>
</template>

<script setup lang="ts">
const sidebarCollapsed = useState('sidebar_collapsed', () => false)
const nuxtLoading = useState<boolean>('nuxt_loading', () => false)
const cmdOpen = useState<boolean>('cmd_open', () => false)
const shortcutOpen = useState<boolean>('shortcut_open', () => false)

const route = useRoute()
watch(
  () => route.path,
  () => {
    nuxtLoading.value = true
    setTimeout(() => (nuxtLoading.value = false), 500)
  },
)

const { items: breadcrumbItems } = useBreadcrumbs()
</script>

<style scoped>
@keyframes loadingbar {
  0% { transform: scaleX(0); transform-origin: left; }
  50% { transform: scaleX(0.7); transform-origin: left; }
  100% { transform: scaleX(1); transform-origin: left; }
}
</style>
