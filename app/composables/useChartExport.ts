/**
 * useChartExport — 图表 PNG 导出工具。
 * v2.2.5: 图表引擎已统一迁移到 chart.js (canvas 渲染), 新增 exportCanvasToPng
 * 直接从 chart.js canvas 导出 (白底合成保证暗色主题下导出可读);
 * 保留 exportSvgToPng 兼容可能残留的 SVG 图表调用方。
 */
export function useChartExport() {
  /** chart.js canvas → PNG 下载 (2x 清晰度, 白底合成) */
  async function exportCanvasToPng(canvas: HTMLCanvasElement | null | undefined, filename = 'chart.png') {
    if (!canvas || !canvas.width || !canvas.height) throw new Error('canvas 未就绪')
    // 白底合成: chart.js canvas 默认透明底, 暗色主题下直接导出在白底查看器中不可读
    const scale = 1
    const out = document.createElement('canvas')
    out.width = canvas.width * scale
    out.height = canvas.height * scale
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0, out.width, out.height)

    return new Promise<void>((resolve, reject) => {
      out.toBlob((blob) => {
        if (!blob) { reject(new Error('Export failed')); return }
        const pngUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = filename
        a.click()
        URL.revokeObjectURL(pngUrl)
        resolve()
      }, 'image/png')
    })
  }

  /** 兼容保留: SVG 元素 → PNG 下载 */
  async function exportSvgToPng(el: HTMLElement | null | undefined, filename = 'chart.png') {
    if (!el) return
    const svg = el.tagName === 'svg' ? el : el.querySelector('svg')
    if (!svg) return

    // Clone the SVG and inline computed styles
    const clone = svg.cloneNode(true) as SVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(svg.clientWidth || 520))
    clone.setAttribute('height', String(svg.clientHeight || 180))

    // White background rect for dark mode exports
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', 'white')
    clone.insertBefore(bg, clone.firstChild)

    const svgData = new XMLSerializer().serializeToString(clone)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    return new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const scale = 2 // 2x for retina quality
        canvas.width = (svg.clientWidth || 520) * scale
        canvas.height = (svg.clientHeight || 180) * scale
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas not supported')); return }
        ctx.scale(scale, scale)
        ctx.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('Export failed')); return }
          const pngUrl = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = pngUrl
          a.download = filename
          a.click()
          URL.revokeObjectURL(pngUrl)
          resolve()
        }, 'image/png')
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')) }
      img.src = url
    })
  }

  return { exportCanvasToPng, exportSvgToPng }
}
