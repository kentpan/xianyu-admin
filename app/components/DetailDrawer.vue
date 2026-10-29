<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="modelValue" class="fixed inset-0 z-[90]">
        <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" @click="onBackdrop" />
        <div
          class="drawer-panel absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-slate-800 shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-700"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <div class="min-w-0">
              <p v-if="eyebrow" class="text-xs text-slate-400 mb-0.5">{{ eyebrow }}</p>
              <h3 class="text-base font-semibold text-slate-900 dark:text-white truncate">{{ title }}</h3>
            </div>
            <button
              class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
              @click="close"
            >
              <Icon name="x" />
            </button>
          </div>
          <!-- Body (scrollable) -->
          <div class="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
            <slot />
          </div>
          <!-- Footer (optional) -->
          <div v-if="$slots.footer" class="px-5 py-3.5 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end gap-2 shrink-0 bg-slate-50/50 dark:bg-slate-800/50">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  eyebrow?: string
  closeOnBackdrop?: boolean
}>(), {
  closeOnBackdrop: true,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; close: [] }>()

function close() {
  emit('update:modelValue', false)
  emit('close')
}
function onBackdrop() {
  if (props.closeOnBackdrop) close()
}

watch(() => props.modelValue, (v) => {
  if (import.meta.client) {
    document.body.style.overflow = v ? 'hidden' : ''
  }
})

// Close on Escape key
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
  if (e.key === 'Escape' && props.modelValue) close()
}
</script>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  transform: translateX(100%);
}
</style>
