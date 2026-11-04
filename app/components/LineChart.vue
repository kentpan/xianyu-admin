<template>
  <div class="w-full">
    <canvas ref="canvasEl" :style="{ width: '100%', height: height + 'px' }" role="img" :aria-label="`折线图: ${unit || '数值'}趋势`"></canvas>
    <!-- Tooltip: chart.js 自带交互提示, 此处保留与旧版一致的数据摘要 (无障碍/打印兜底) -->
    <div class="sr-only">{{ labels.join(' / ') }} = {{ data.join(', ') }} {{ unit }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * LineChart — chart.js 折线图 (v2.2.5: 由手写 SVG 迁移到 chart.js, 工作台/订单趋势统一图表引擎)。
 * Props API 与旧版 SVG 实现完全一致 (data/labels/color/unit/height), 调用方零改动。
 * chart.js 仅在客户端挂载后初始化 (SSR 只渲染空 canvas), 数据/主题变化自动 update。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Chart, LineController, LineElement, PointElement, Filler, LinearScale, CategoryScale, Tooltip, Legend } from 'chart.js'

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

// chart.js 树摇登记: 本组件用到的控制器/元素/比例尺/交互件 (不用全量 registerables)
Chart.register(LineController, LineElement, PointElement, Filler, LinearScale, CategoryScale, Tooltip, Legend)

const canvasEl = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null
let themeObserver: MutationObserver | null = null

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/** 主色 → 半透明填充色 (区域渐变用) */
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

  // 区域渐变 (canvas 2d context 级)
  const ctx = canvasEl.value.getContext('2d')
  const areaH = props.height
  let fill: string | CanvasGradient = alpha(props.color, 0.22)
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, areaH)
    g.addColorStop(0, alpha(props.color, 0.28))
    g.addColorStop(1, alpha(props.color, 0.02))
    fill = g
  }

  chart?.destroy()
  chart = new Chart(canvasEl.value, {
    type: 'line',
    data: {
      labels: props.labels,
      datasets: [
        {
          data: props.data,
          borderColor: props.color,
          backgroundColor: fill,
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: props.color,
          pointBorderColor: dark ? '#0f172a' : '#ffffff',
          pointBorderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: dark ? '#1e293b' : '#0f172a',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          padding: 8,
          displayColors: false,
          callbacks: {
            label: (item) => ` ${item.parsed.y}${props.unit ? ' ' + props.unit : ''}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tick, maxRotation: 0, autoSkip: false, font: { size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: grid, drawTicks: false },
          border: { display: false },
          ticks: { color: tick, font: { size: 11 }, maxTicksLimit: 5, precision: 0 },
        },
      },
    },
  })
}

onMounted(() => {
  buildChart()
  // 主题切换 (tailwind darkMode: 'class') → 重建图表以适配配色
  themeObserver = new MutationObserver(() => buildChart())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

watch(
  () => [props.data, props.labels, props.color],
  () => {
    if (chart) {
      chart.data.labels = props.labels
      chart.data.datasets[0].data = props.data
      chart.data.datasets[0].borderColor = props.color
      chart.data.datasets[0].pointBackgroundColor = props.color
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

/** 供父级导出 PNG 用 (chart.js canvas.toBase64Image) */
defineExpose({
  toPngBase64: () => chart?.toBase64Image('image/png', 1) || '',
})
</script>
