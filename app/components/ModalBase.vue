<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-[90] flex items-center justify-center p-4" @click.self="onBackdrop">
        <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
        <div
          class="modal-panel relative w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col"
          :class="sizeClass"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <h3 class="text-base font-semibold text-slate-900 dark:text-white">{{ title }}</h3>
            <button
              class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              @click="close"
            >
              <Icon name="x" />
            </button>
          </div>
          <!-- Body -->
          <div class="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
            <slot />
          </div>
          <!-- Footer (optional) -->
          <div v-if="$slots.footer" class="px-5 py-3.5 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end gap-2 shrink-0 bg-slate-50/50 dark:bg-slate-800/50 rounded-b-xl">
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
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnBackdrop?: boolean
}>(), {
  size: 'md',
  closeOnBackdrop: true,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; close: [] }>()

const sizeClass = computed(() => ({
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}[props.size]))

function close() {
  emit('update:modelValue', false)
  emit('close')
}
function onBackdrop() {
  if (props.closeOnBackdrop) close()
}

// Lock body scroll when open
watch(() => props.modelValue, (v) => {
  if (import.meta.client) {
    document.body.style.overflow = v ? 'hidden' : ''
  }
})
</script>
