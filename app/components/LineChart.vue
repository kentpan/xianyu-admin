<template>
  <div class="w-full">
    <svg :viewBox="`0 0 ${w} ${h}`" :width="w" :height="h" class="overflow-visible">
      <!-- Grid lines -->
      <g stroke="currentColor" class="text-slate-200 dark:text-slate-700" stroke-width="1">
        <line v-for="i in 4" :key="i" :x1="padL" :x2="w - padR" :y1="padT + ((h - padT - padB) / 4) * (i - 1)" :y2="padT + ((h - padT - padB) / 4) * (i - 1)" stroke-dasharray="3 3" opacity="0.5" />
      </g>
      <!-- Area fill -->
      <defs>
        <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.25" />
          <stop offset="100%" :stop-color="color" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path v-if="areaPath" :d="areaPath" :fill="`url(#${gradId})`" />
      <!-- Line -->
      <path v-if="linePath" :d="linePath" fill="none" :stroke="color" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <!-- Data points -->
      <g>
        <circle v-for="(p, i) in points" :key="i" :cx="p.x" :cy="p.y" :r="hover === i ? 5 : 3.5" :fill="color" stroke="white" stroke-width="1.5" class="transition-all cursor-pointer" @mouseenter="hover = i" @mouseleave="hover = -1" />
      </g>
      <!-- X axis labels -->
      <g class="text-slate-400" font-size="11" text-anchor="middle">
        <text v-for="(p, i) in points" :key="i" :x="p.x" :y="h - 4">{{ labels[i] }}</text>
      </g>
    </svg>
    <!-- Tooltip -->
    <div v-if="hover >= 0 && points[hover]" class="text-xs text-slate-500 dark:text-slate-400 text-center mt-1">
      <span class="font-medium text-slate-700 dark:text-slate-200">{{ labels[hover] }}</span>: {{ data[hover] }} {{ unit }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  data: number[]
  labels: string[]
  color?: string
  unit?: string
  height?: number
}>(), {
  color: '#f59e0b',
  unit: '',
  height: 180,
})

const hover = ref(-1)
const gradId = `line-grad-${Math.random().toString(36).slice(2, 8)}`

const w = 520
const h = computed(() => props.height)
const padL = 30
const padR = 16
const padT = 16
const padB = 24

const maxVal = computed(() => Math.max(...props.data, 1))
const innerW = computed(() => w - padL - padR)
const innerH = computed(() => h.value - padT - padB)

const points = computed(() => {
  const n = props.data.length
  if (n === 0) return []
  const step = n > 1 ? innerW.value / (n - 1) : 0
  return props.data.map((v, i) => ({
    x: padL + step * i,
    y: padT + innerH.value - (v / maxVal.value) * innerH.value,
  }))
})

const linePath = computed(() => {
  if (!points.value.length) return ''
  return points.value.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
})

const areaPath = computed(() => {
  if (!points.value.length) return ''
  const pts = points.value
  const base = padT + innerH.value
  return `M ${pts[0].x} ${base} ${pts.map((p) => `L ${p.x} ${p.y}`).join(' ')} L ${pts[pts.length - 1].x} ${base} Z`
})
</script>
