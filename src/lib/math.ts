import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/mjs/svg.js'
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const input = new TeX({
  packages: ['base', 'ams'],
  maxBuffer: 4096,
  maxMacros: 1000,
  formatError: (_jax: unknown, error: Error) => {
    throw error
  },
})
const output = new SVG({
  fontCache: 'none',
  fontData: new MathJaxTexFont(),
  linebreaks: { inline: false },
})
const document = mathjax.document('', { InputJax: input, OutputJax: output })

export interface MathRendering {
  svg: string
  width: number
  height: number
  error: string
}
const cache = new Map<string, MathRendering>()

export function renderMath(tex: string): MathRendering {
  const cached = cache.get(tex)
  if (cached) return cached
  let result: MathRendering
  try {
    if (tex.length > 2000) throw new Error('公式不能超过 2000 个字符。')
    const node = document.convert(tex, { display: false })
    const svg = adaptor.firstChild(node)
    if (!svg || !('attributes' in svg)) throw new Error('未生成 SVG 公式。')
    const markup = adaptor.outerHTML(svg)
    const width = Number.parseFloat(adaptor.getAttribute(svg, 'width') ?? '0') * 8
    const height = Number.parseFloat(adaptor.getAttribute(svg, 'height') ?? '0') * 8
    const viewBox = (adaptor.getAttribute(svg, 'viewBox') ?? '').trim().split(/\s+/).map(Number)
    if (
      ![width, height, ...viewBox].every(Number.isFinite) ||
      viewBox.length !== 4 ||
      width < 0 ||
      height < 0 ||
      width > 10000 ||
      height > 10000
    )
      throw new Error('公式尺寸超出可绘制范围，请缩短公式或减小显式尺寸。')
    if (markup.includes('data-mml-node="merror"'))
      throw new Error('无法解析公式，请检查 LaTeX 语法。')
    // Explicit pixel size makes nested SVG labels independent of inherited font units.
    adaptor.setAttribute(svg, 'width', String(width))
    adaptor.setAttribute(svg, 'height', String(height))
    result = { svg: adaptor.outerHTML(svg), width, height, error: '' }
  } catch (error) {
    result = {
      svg: '',
      width: 0,
      height: 0,
      error: `公式错误：${error instanceof Error ? error.message : '无法解析 LaTeX'}`,
    }
  }
  if (cache.size >= 300) cache.delete(cache.keys().next().value!)
  cache.set(tex, result)
  return result
}
