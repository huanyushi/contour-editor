export interface ExportOptions {
  region: 'content' | 'view'
  background: 'white' | 'transparent'
  axes: boolean
  grid: boolean
  endpoints: boolean
  scale: 1 | 2 | 3
}
export const defaultExportOptions = (): ExportOptions => ({
  region: 'content',
  background: 'white',
  axes: true,
  grid: false,
  endpoints: false,
  scale: 2,
})
const SVG_NS = 'http://www.w3.org/2000/svg'

/** Produce an independent copy, never toggling the live editor's view or selection. */
export function serializeSvg(source: SVGSVGElement, options: ExportOptions): string {
  const svg = source.cloneNode(true) as SVGSVGElement
  svg.querySelectorAll('[data-export-omit]').forEach((node) => node.remove())
  // A live canvas preview replaces the drawing, but exports still use applied geometry.
  svg.querySelectorAll('[data-export-preview-source]').forEach((node) => {
    node.removeAttribute('visibility')
  })
  for (const [flag, enabled] of [
    ['axes', options.axes],
    ['grid', options.grid],
    ['endpoint', options.endpoints],
  ] as const) {
    svg.querySelectorAll(`[data-export-${flag}]`).forEach((node) => {
      if (!enabled) node.remove()
      else node.removeAttribute('visibility')
    })
  }
  svg
    .querySelector('[data-export-background]')
    ?.setAttribute('fill', options.background === 'white' ? '#ffffff' : 'none')
  // Drawing styles are SVG attributes or inline MathJax colors, not editor CSS.
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (
        attribute.name.startsWith('data-') ||
        attribute.name.startsWith('on') ||
        ['class', 'tabindex', 'aria-describedby', 'pointer-events'].includes(attribute.name)
      )
        node.removeAttribute(attribute.name)
    }
  }
  svg.removeAttribute('xmlns')
  svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', SVG_NS)
  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0)
    throw new Error('SVG 导出区域必须具有有效的正尺寸。')
  svg.setAttribute('width', String(viewBox[2]))
  svg.setAttribute('height', String(viewBox[3]))
  svg.setAttribute('overflow', 'hidden')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', '复平面围道')
  const title = document.createElementNS(SVG_NS, 'title')
  title.textContent = 'Complex Contour Editor · 复平面围道'
  svg.prepend(title)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`
}

export function renderPng(svgText: string, scale: 1 | 2 | 3): Promise<Blob> {
  if (![1, 2, 3].includes(scale)) return Promise.reject(new Error('PNG 倍率只能为 1×、2× 或 3×。'))
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
    const image = new Image()
    const cleanup = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      image.onload = null
      image.onerror = null
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('SVG 图像加载超时，请重试。'))
    }, 10000)
    image.onerror = () => {
      cleanup()
      reject(new Error('无法将 SVG 渲染为 PNG。'))
    }
    image.onload = () => {
      try {
        const width = Math.ceil(image.naturalWidth * scale)
        const height = Math.ceil(image.naturalHeight * scale)
        if (
          ![width, height].every(Number.isFinite) ||
          width <= 0 ||
          height <= 0 ||
          width > 16384 ||
          height > 16384 ||
          width * height > 64_000_000
        )
          throw new Error('PNG 尺寸超出安全范围（单边最多 16384 像素，总计最多 6400 万像素）。')
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('浏览器不支持 Canvas 图像导出。')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('PNG 编码失败。'))),
          'image/png',
        )
      } catch (error) {
        reject(error)
      } finally {
        cleanup()
      }
    }
    image.src = url
  })
}
