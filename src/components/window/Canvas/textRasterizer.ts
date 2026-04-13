import type { TextLayerState } from '@/types'
import type { WebGLLayer } from '@/webgl/WebGLRenderer'

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
  ctx2d.fillText(ls.text, ls.x, ls.y)

  if (ls.underline) {
    const m = ctx2d.measureText(ls.text)
    const lineY = ls.y + ls.fontSize + 2
    const lineH = Math.max(1, Math.round(ls.fontSize / 14))
    ctx2d.fillRect(ls.x, lineY, m.width, lineH)
  }

  gl.data.set(new Uint8Array(ctx2d.getImageData(0, 0, w, h).data.buffer))
}
