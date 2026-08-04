<template>
  <div class="relative">
    <button
      class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors flex items-center gap-1.5"
      title="主题色"
      @click="open = !open"
    >
      <span class="w-4 h-4 rounded-full" :style="{ background: currentDef[500] }" />
      <span class="hidden md:inline text-xs">{{ currentDef.label }}</span>
    </button>
    <!-- Dropdown -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="open" class="fixed inset-0 z-[88]" @click.self="open = false">
          <div class="absolute inset-0" @click="open = false" />
          <div class="modal-panel absolute right-3 top-14 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden p-2">
            <p class="px-2 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">主题色</p>
            <button
              v-for="t in themes"
              :key="t.key"
              class="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors"
              :class="current === t.key ? 'bg-slate-100 dark:bg-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'"
              @click="select(t.key)"
            >
              <span class="w-5 h-5 rounded-full shrink-0 ring-2 ring-offset-1 dark:ring-offset-slate-800" :class="current === t.key ? 'ring-slate-400' : 'ring-transparent'" :style="{ background: t[500] }" />
              <span class="text-sm flex-1" :class="current === t.key ? 'font-medium text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'">{{ t.label }}</span>
              <Icon v-if="current === t.key" name="check" class="text-brand-500 text-sm" />
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { useThemeColor, type ThemeColor } from '~/composables/useThemeColor'

const { current, themes, apply } = useThemeColor()
const open = ref(false)

const currentDef = computed(() => themes.find((t) => t.key === current.value) || themes[0])

function select(key: ThemeColor) {
  apply(key)
  open.value = false
}
</script>
