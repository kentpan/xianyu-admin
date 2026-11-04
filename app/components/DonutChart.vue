<template>
  <div class="flex items-center gap-6">
    <!-- Donut chart (chart.js doughnut) -->
    <div class="relative shrink-0" :style="{ width: size + 'px', height: size + 'px' }">
      <canvas
        ref="canvasEl"
        :style="{ width: size + 'px', height: size + 'px' }"
        role="img"
        :aria-label="`环形图: ${centerLabel}分布, 共 ${total} 项`"
      ></canvas>
      <!-- Center label -->
      <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span class="text-2xl font-bold text-slate-900 dark:text-white">{{ total }}</span>
        <span class="text-xs text-slate-400 mt-0.5">{{ centerLabel }}</span>
      </div>
    </div>
    <!-- Legend (showLegend=false 时由父级自绘图例/进度条, 避免重复与窄容器溢出重叠) -->
    <div v-if="showLegend" class="flex-1 space-y-2 min-w-0">
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
/**
 * DonutChart — chart.js 环形图 (v2.2.5: 由手写 SVG 迁移到 chart.js, 工作台统一图表引擎)。
 * Props API 与旧版 SVG 实现完全一致 (data[{key,label,value,color}]/size/strokeWidth/centerLabel),
 * 图例仍为 HTML 渲染 (与旧版视觉一致), canvas 只画环形本体。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js'

interface Segment {
  key: string
  label: string
  value: number
  color: string
  pct: number
}

const props = withDefaults(defineProps<{
  data: { key: string; label: string; value: number; color: string }[]
  size?: number
  strokeWidth?: number
  centerLabel?: string
  /** 是否渲染内置 HTML 图例 (默认 true; 父级已自绘图例时传 false) */
  showLegend?: boolean
}>(), {
  size: 160,
  strokeWidth: 18,
  centerLabel: '总数',
  showLegend: true,
})

Chart.register(DoughnutController, ArcElement, Tooltip, Legend)

const canvasEl = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null

const total = computed(() => props.data.reduce((s, d) => s + d.value, 0))

const segments = computed<Segment[]>(() => {
  const t = total.value || 1
  return props.data
    .filter((d) => d.value > 0)
    .map((d) => ({ ...d, pct: Math.round((d.value / t) * 100) }))
})

function buildChart() {
  if (!canvasEl.value || typeof document === 'undefined') return
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  chart?.destroy()
  chart = new Chart(canvasEl.value, {
    type: 'doughnut',
    data: {
      labels: segments.value.map((s) => s.label),
      datasets: [
        {
          data: segments.value.map((s) => s.value),
          backgroundColor: segments.value.map((s) => s.color),
          borderColor: dark ? '#111a2c' : '#ffffff',
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: false,
      cutout: `${Math.max(50, 100 - Math.round((props.strokeWidth / props.size) * 200))}%`,
      animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: dark ? '#1e293b' : '#0f172a',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          padding: 8,
          callbacks: {
            label: (item) => ` ${item.parsed} 单 (${item.label})`,
          },
        },
      },
    },
  })
}

onMounted(() => buildChart())

watch(
  () => [segments.value, props.size, props.strokeWidth],
  () => buildChart(),
  { deep: true },
)

onBeforeUnmount(() => {
  chart?.destroy()
  chart = null
})

/** 供父级导出 PNG 用 */
defineExpose({
  toPngBase64: () => chart?.toBase64Image('image/png', 1) || '',
})
</script>
