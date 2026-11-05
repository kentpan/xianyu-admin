<template>
  <div class="w-full cursor-pointer select-none" :title="clickHint" @click="emit('activate')">
    <canvas ref="canvasEl" :style="{ width: '100%', height: height + 'px' }" role="img" :aria-label="`柱线混合图: ${barLabel}与${lineLabel}趋势, 点击查看核心指标`"></canvas>
    <div class="sr-only">{{ labels.join(' / ') }} 订单量={{ barData.join(',') }} 收入={{ lineData.join(',') }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * BarLineChart — chart.js 柱线混合图 (v2.2.5 新增, 订单趋势页专用)。
 * 柱 = 每日订单量, 线 = 每日收入; 点击图表触发 activate (打开核心指标弹窗)。
 * chart.js 仅在客户端挂载后初始化; 数据/主题变化自动 update。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend } from 'chart.js'

const props = withDefaults(defineProps<{
  labels: string[]
  barData: number[]
  lineData: number[]
  barLabel?: string
  lineLabel?: string
  barColor?: string
  lineColor?: string
  height?: number
  clickHint?: string
}>(), {
  barLabel: '订单量',
  lineLabel: '收入(¥)',
  barColor: '#f59e0b',
  lineColor: '#10b981',
  height: 240,
  clickHint: '点击查看核心指标详情',
})

const emit = defineEmits<{ (e: 'activate'): void }>()

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend)

const canvasEl = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null
let themeObserver: MutationObserver | null = null

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function buildChart() {
  if (!canvasEl.value || typeof document === 'undefined') return
  const dark = isDark()
  const grid = dark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.15)'
  const tick = dark ? '#94a3b8' : '#64748b'
  const tooltipBg = dark ? '#1e293b' : '#0f172a'

  chart?.destroy()
  chart = new Chart(canvasEl.value, {
    data: {
      labels: props.labels,
      datasets: [
        {
          type: 'bar' as const,
          label: props.barLabel,
          data: props.barData,
          backgroundColor: alpha(props.barColor, 0.55),
          hoverBackgroundColor: props.barColor,
          borderWidth: 0,
          borderRadius: 4,
          maxBarThickness: 42,
          order: 2,
        },
        {
          type: 'line' as const,
          label: props.lineLabel,
          data: props.lineData,
          borderColor: props.lineColor,
          backgroundColor: props.lineColor,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: props.lineColor,
          pointBorderColor: dark ? '#0f172a' : '#ffffff',
          pointBorderWidth: 1.5,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { color: tick, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          padding: 8,
          callbacks: {
            label: (item) => {
              const v = Number(item.parsed.y)
              const isLine = item.dataset.type === 'line'
              return ` ${item.dataset.label}: ${isLine ? '¥' + v.toFixed(2) : v + ' 单'}`
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tick, maxRotation: 0, autoSkip: false, font: { size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: grid, drawTicks: false },
          border: { display: false },
          ticks: { color: tick, font: { size: 11 }, maxTicksLimit: 6, precision: 0 },
        },
      },
    },
  })
}

onMounted(() => {
  buildChart()
  themeObserver = new MutationObserver(() => buildChart())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

watch(
  () => [props.labels, props.barData, props.lineData],
  () => {
    if (chart) {
      chart.data.labels = props.labels
      const barDs = chart.data.datasets[0]
      const lineDs = chart.data.datasets[1]
      if (barDs) barDs.data = props.barData
      if (lineDs) lineDs.data = props.lineData
      chart.update()
    } else {
      buildChart()
    }
  },
  { deep: true },
)

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  chart?.destroy()
  chart = null
})

defineExpose({
  toPngBase64: () => chart?.toBase64Image('image/png', 1) || '',
})
</script>
