<template>
  <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm shadow-card-hover animate-fade-in max-w-sm text-white"
      :class="{
        'bg-emerald-600': t.type === 'success',
        'bg-red-600': t.type === 'error',
        'bg-amber-500': t.type === 'warning',
        'bg-slate-800 dark:bg-slate-700': t.type === 'info',
      }"
    >
      <Icon :name="iconFor(t.type)" />
      <span>{{ t.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from '~/composables/useToast'
const { toasts } = useToast()
function iconFor(type: string) {
  return type === 'success' ? 'check' : type === 'error' ? 'alert' : type === 'warning' ? 'alert' : 'info'
}
</script>
