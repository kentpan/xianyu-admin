<template>
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-semibold text-slate-900 dark:text-white">数据对比</h3>
      <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
        <button class="px-3 py-1 rounded-md text-xs font-medium transition-colors" :class="mode === 'day' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500'" @click="mode = 'day'">今日 vs 昨日</button>
        <button class="px-3 py-1 rounded-md text-xs font-medium transition-colors" :class="mode === 'week' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500'" @click="mode = 'week'">本周 vs 上周</button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <!-- Orders comparison -->
      <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <p class="text-xs text-slate-400 mb-2">订单数</p>
        <div class="flex items-end gap-3 mb-2">
          <div>
            <p class="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{{ current.orders }}</p>
            <p class="text-[10px] text-slate-400">{{ currentLabel }}</p>
          </div>
          <div class="pb-1">
            <p class="text-sm text-slate-400 tabular-nums line-through">{{ previous.orders }}</p>
            <p class="text-[10px] text-slate-400">{{ previousLabel }}</p>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <Icon :name="delta.orders >= 0 ? 'trendUp' : 'trendDown'" :class="delta.orders >= 0 ? 'text-emerald-500' : 'text-rose-500'" class="text-sm" />
          <span class="text-sm font-medium tabular-nums" :class="delta.orders >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
            {{ delta.orders >= 0 ? '+' : '' }}{{ delta.orders }}
          </span>
          <span class="text-xs text-slate-400">({{ delta.ordersPct >= 0 ? '+' : '' }}{{ delta.ordersPct }}%)</span>
        </div>
      </div>

      <!-- Revenue comparison -->
      <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <p class="text-xs text-slate-400 mb-2">收入 (¥)</p>
        <div class="flex items-end gap-3 mb-2">
          <div>
            <p class="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">¥{{ current.revenue.toFixed(2) }}</p>
            <p class="text-[10px] text-slate-400">{{ currentLabel }}</p>
          </div>
          <div class="pb-1">
            <p class="text-sm text-slate-400 tabular-nums line-through">¥{{ previous.revenue.toFixed(2) }}</p>
            <p class="text-[10px] text-slate-400">{{ previousLabel }}</p>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <Icon :name="delta.revenue >= 0 ? 'trendUp' : 'trendDown'" :class="delta.revenue >= 0 ? 'text-emerald-500' : 'text-rose-500'" class="text-sm" />
          <span class="text-sm font-medium tabular-nums" :class="delta.revenue >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
            {{ delta.revenue >= 0 ? '+' : '' }}¥{{ delta.revenue.toFixed(2) }}
          </span>
          <span class="text-xs text-slate-400">({{ delta.revenuePct >= 0 ? '+' : '' }}{{ delta.revenuePct }}%)</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  data: {
    periods: { today: any; yesterday: any; thisWeek: any; lastWeek: any }
    comparison: { todayVsYesterday: any; weekVsLastWeek: any }
  }
}>()

const mode = ref<'day' | 'week'>('day')

const current = computed(() => mode.value === 'day' ? props.data.periods.today : props.data.periods.thisWeek)
const previous = computed(() => mode.value === 'day' ? props.data.periods.yesterday : props.data.periods.lastWeek)
const delta = computed(() => mode.value === 'day' ? props.data.comparison.todayVsYesterday : props.data.comparison.weekVsLastWeek)
const currentLabel = computed(() => mode.value === 'day' ? '今日' : '本周')
const previousLabel = computed(() => mode.value === 'day' ? '昨日' : '上周')
</script>
