<template>
  <div class="flex items-center gap-6">
    <!-- Donut chart -->
    <div class="relative shrink-0" :style="{ width: size + 'px', height: size + 'px' }">
      <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" class="-rotate-90">
        <!-- Background ring -->
        <circle
          :cx="size / 2" :cy="size / 2" :r="radius" fill="none"
          :stroke="trackColor" :stroke-width="strokeWidth"
        />
        <!-- Segments -->
        <template v-for="(seg, i) in segments" :key="seg.key">
          <circle
            :cx="size / 2" :cy="size / 2" :r="radius" fill="none"
            :stroke="seg.color" :stroke-width="strokeWidth"
            :stroke-dasharray="`${seg.arc} ${circumference}`"
            :stroke-dashoffset="-seg.offset"
            stroke-linecap="round"
            style="transition: stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease;"
          />
        </template>
      </svg>
      <!-- Center label -->
      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <span class="text-2xl font-bold text-slate-900 dark:text-white">{{ total }}</span>
        <span class="text-xs text-slate-400 mt-0.5">{{ centerLabel }}</span>
      </div>
    </div>
    <!-- Legend -->
    <div class="flex-1 space-y-2 min-w-0">
      <div v-for="seg in segments" :key="seg.key" class="flex items-center gap-2.5">
        <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: seg.color }" />
        <span class="text-sm text-slate-600 dark:text-slate-300 truncate flex-1">{{ seg.label }}</span>
        <span class="text-sm font-medium text-slate-800 dark:text-slate-100 tabular-nums">{{ seg.value }}</span>
        <span class="text-xs text-slate-400 tabular-nums w-10 text-right">{{ seg.pct }}%</span>
      </div>
      <div v-if="!segments.length" class="text-sm text-slate-400 py-2">暂无数据</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Segment {
  key: string
  label: string
  value: number
  color: string
  arc: number
  offset: number
  pct: number
}

const props = withDefaults(defineProps<{
  data: { key: string; label: string; value: number; color: string }[]
  size?: number
  strokeWidth?: number
  centerLabel?: string
}>(), {
  size: 160,
  strokeWidth: 18,
  centerLabel: '总数',
})

const trackColor = computed(() => 'rgb(226 232 240 / 0.6)')

const radius = computed(() => (props.size - props.strokeWidth) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)

const total = computed(() => props.data.reduce((s, d) => s + d.value, 0))

const segments = computed<Segment[]>(() => {
  const t = total.value || 1
  let acc = 0
  return props.data
    .filter((d) => d.value > 0)
    .map((d) => {
      const arc = (d.value / t) * circumference.value
      const offset = acc
      acc += arc
      return {
        ...d,
        arc,
        offset,
        pct: Math.round((d.value / t) * 100),
      }
    })
})
</script>
