<template>
  <span class="badge" :class="cls">{{ label }}</span>
</template>

<script setup lang="ts">
const props = defineProps<{ status?: string }>()

const META: Record<string, { label: string; cls: string }> = {
  pending_ship: { label: '待发货', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  shipped: { label: '已发货', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  completed: { label: '已完成', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400' },
  refunding: { label: '退款中', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  processing: { label: '处理中', cls: 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' },
  unknown: { label: '未知', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400' },
}

const meta = computed(() => META[props.status || 'unknown'] || META.unknown)
const label = computed(() => meta.value.label)
const cls = computed(() => meta.value.cls)
</script>
