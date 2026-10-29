<template>
  <div class="card p-5 group relative overflow-hidden transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5">
    <!-- Decorative gradient blob -->
    <div
      class="absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-10 blur-2xl transition-opacity group-hover:opacity-20"
      :class="blobClass"
    />
    <div class="relative flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-slate-500 dark:text-slate-400">{{ label }}</p>
        <p class="text-2xl font-semibold text-slate-900 dark:text-white mt-1 tabular-nums">{{ displayValue }}</p>
        <p v-if="hint" class="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
          <span class="w-1 h-1 rounded-full" :class="dotClass" />
          {{ hint }}
        </p>
      </div>
      <div
        class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
        :class="colorClass"
      >
        <Icon :name="icon" class="text-lg" />
      </div>
    </div>
    <div v-if="trend !== null && trend !== undefined" class="relative mt-3 flex items-center gap-1 text-xs">
      <Icon :name="trend >= 0 ? 'trendUp' : 'trendDown'" :class="trend >= 0 ? 'text-emerald-500' : 'text-red-500'" />
      <span :class="trend >= 0 ? 'text-emerald-600' : 'text-red-600'" class="font-medium tabular-nums">{{ Math.abs(trend) }}%</span>
      <span class="text-slate-400">较昨日</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  value: number | string
  icon: string
  hint?: string
  trend?: number | null
  color?: 'amber' | 'emerald' | 'sky' | 'rose' | 'slate'
}>()

const colorClass = computed(() => {
  const c = props.color || 'amber'
  return {
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    sky: 'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
    rose: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300',
  }[c]
})

const blobClass = computed(() => {
  const c = props.color || 'amber'
  return {
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    sky: 'bg-sky-500',
    rose: 'bg-rose-500',
    slate: 'bg-slate-500',
  }[c]
})

const dotClass = computed(() => {
  const c = props.color || 'amber'
  return {
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    sky: 'bg-sky-500',
    rose: 'bg-rose-500',
    slate: 'bg-slate-400',
  }[c]
})

const displayValue = computed(() => {
  if (typeof props.value === 'number') return props.value.toLocaleString()
  return props.value
})
</script>
