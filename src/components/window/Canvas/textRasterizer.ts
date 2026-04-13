import type { TextLayerState } from '@/types'
import type { WebGLLayer } from '@/webgl/WebGLRenderer'

/** Break a single paragraph into lines that fit within maxWidth canvas pixels. */
function wrapLine(ctx2d: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text]
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx2d.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

/**
 * Rasterize a TextLayerState's text into the WebGL layer's pixel buffer.
 * The layer must already be canvas-sized (offsetX=0, offsetY=0).
 * Call renderer.flushLayer() after this to upload to GPU.
 */
export function rasterizeTextToLayer(ls: TextLayerState, gl: WebGLLayer): void {
  const w = gl.layerWidth
  const h = gl.layerHeight
  gl.data.fill(0) // clear existing pixels
  if (!ls.text) return

  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const ctx2d = tmp.getContext('2d')!

  const fontStyle = [
    ls.italic ? 'italic' : '',
    ls.bold ? 'bold' : '',
    `${ls.fontSize}px`,
    `"${ls.fontFamily}", sans-serif`,
  ].filter(Boolean).join(' ')

  ctx2d.font = fontStyle
  ctx2d.textBaseline = 'top'
  ctx2d.fillStyle = `rgba(${ls.color.r}, ${ls.color.g}, ${ls.color.b}, ${ls.color.a / 255})`

  const lineHeight = ls.fontSize * 1.2
  const underlineThick = Math.max(1, Math.round(ls.fontSize / 14))
  const boxW = ls.boxWidth  > 0 ? ls.boxWidth  : 0
  const boxH = ls.boxHeight > 0 ? ls.boxHeight : 0
  const align = ls.align ?? 'left'

  // Build final wrapped line list
  const wrappedLines: string[] = []
  for (const para of ls.text.split('\n')) {
    const wrapped = wrapLine(ctx2d, para, boxW)
    wrappedLines.push(...wrapped)
  }

  wrappedLines.forEach((line, i) => {
    const lineY = ls.y + i * lineHeight
    // Clip to box height if constrained
    if (boxH > 0 && lineY - ls.y + lineHeight > boxH) return

    let drawX = ls.x
    const textW = ctx2d.measureText(line).width

    if (boxW > 0) {
      if (align === 'center') {
        drawX = ls.x + (boxW - textW) / 2
      } else if (align === 'right') {
        drawX = ls.x + boxW - textW
      } else if (align === 'justify' && i < wrappedLines.length - 1) {
        // Justified: stretch spaces between words
        const words = line.split(' ')
        if (words.length > 1) {
          const spaceW = (boxW - ctx2d.measureText(line.replace(/ /g, '')).width) / (words.length - 1)
          let cx = ls.x
          words.forEach((word, _wi) => {
            ctx2d.fillText(word, cx, lineY)
            if (ls.underline && word.length > 0) {
              const ww = ctx2d.measureText(word).width
              ctx2d.fillRect(cx, lineY + ls.fontSize + 2, ww, underlineThick)
            }
            cx += ctx2d.measureText(word).width + spaceW
          })
          return
        }
      }
    }

    ctx2d.fillText(line, drawX, lineY)
    if (ls.underline && line.length > 0) {
      ctx2d.fillRect(drawX, lineY + ls.fontSize + 2, textW, underlineThick)
    }
  })

  gl.data.set(new Uint8Array(ctx2d.getImageData(0, 0, w, h).data.buffer))
}
