/**
 * useChartExport — export an SVG chart element to PNG.
 * Finds the nearest <svg> ancestor of a given element, serializes it,
 * renders to canvas, and triggers a PNG download.
 */
export function useChartExport() {
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

  return { exportSvgToPng }
}
