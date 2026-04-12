import {
  compileShader,
  linkProgram,
  createPixelTexture,
  uploadTextureData,
  createStaticBuffer,
  fillRectBuffer
} from './utils'
import { IMAGE_VERT, IMAGE_FRAG, CHECKER_VERT, CHECKER_FRAG, BLIT_VERT, BLIT_FRAG } from './shaders'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebGLLayer {
  id: string
  name: string
  texture: WebGLTexture
  data: Uint8Array
  opacity: number
  visible: boolean
  blendMode: string
}

const BLEND_MODE_INDEX: Record<string, number> = {
  'normal': 0, 'multiply': 1, 'screen': 2, 'overlay': 3,
  'soft-light': 4, 'hard-light': 5, 'darken': 6, 'lighten': 7,
  'difference': 8, 'exclusion': 9, 'color-dodge': 10, 'color-burn': 11,
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class WebGLRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly imageProgram: WebGLProgram
  private readonly checkerProgram: WebGLProgram
  private readonly blitProgram: WebGLProgram
  private readonly posBuffer: WebGLBuffer
  private readonly texCoordBuffer: WebGLBuffer
  // Two framebuffers for ping-pong compositing
  private fb0: WebGLFramebuffer
  private fb1: WebGLFramebuffer
  private fbTex0: WebGLTexture
  private fbTex1: WebGLTexture
  readonly pixelWidth: number
  readonly pixelHeight: number

  constructor(canvas: HTMLCanvasElement, pixelWidth: number, pixelHeight: number) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true
    })
    if (!gl) throw new Error('WebGL2 is not supported in this environment')

    this.gl = gl
    this.pixelWidth = pixelWidth
    this.pixelHeight = pixelHeight

    this.imageProgram = linkProgram(
      gl,
      compileShader(gl, gl.VERTEX_SHADER, IMAGE_VERT),
      compileShader(gl, gl.FRAGMENT_SHADER, IMAGE_FRAG)
    )
    this.checkerProgram = linkProgram(
      gl,
      compileShader(gl, gl.VERTEX_SHADER, CHECKER_VERT),
      compileShader(gl, gl.FRAGMENT_SHADER, CHECKER_FRAG)
    )
    this.blitProgram = linkProgram(
      gl,
      compileShader(gl, gl.VERTEX_SHADER, BLIT_VERT),
      compileShader(gl, gl.FRAGMENT_SHADER, BLIT_FRAG)
    )

    const posBuffer = gl.createBuffer()
    if (!posBuffer) throw new Error('Failed to allocate position buffer')
    this.posBuffer = posBuffer

    this.texCoordBuffer = createStaticBuffer(
      gl,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
    )

    // Ping-pong framebuffers
    const [fb0, tex0] = this.createFramebuffer(pixelWidth, pixelHeight)
    const [fb1, tex1] = this.createFramebuffer(pixelWidth, pixelHeight)
    this.fb0 = fb0; this.fbTex0 = tex0
    this.fb1 = fb1; this.fbTex1 = tex1

    gl.disable(gl.BLEND)
  }

  private createFramebuffer(w: number, h: number): [WebGLFramebuffer, WebGLTexture] {
    const { gl } = this
    const tex = createPixelTexture(gl, w, h, null)
    const fb = gl.createFramebuffer()
    if (!fb) throw new Error('Failed to create framebuffer')
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return [fb, tex]
  }

  // ─── Layer management ──────────────────────────────────────────────────────

  createLayer(id: string, name: string): WebGLLayer {
    const { gl, pixelWidth, pixelHeight } = this
    const data = new Uint8Array(pixelWidth * pixelHeight * 4)
    const texture = createPixelTexture(gl, pixelWidth, pixelHeight, data)
    return { id, name, texture, data, opacity: 1, visible: true, blendMode: 'normal' }
  }

  flushLayer(layer: WebGLLayer): void {
    uploadTextureData(this.gl, layer.texture, this.pixelWidth, this.pixelHeight, layer.data)
  }

  destroyLayer(layer: WebGLLayer): void {
    this.gl.deleteTexture(layer.texture)
  }

  // ─── Pixel operations ──────────────────────────────────────────────────────

  drawPixel(layer: WebGLLayer, x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= this.pixelWidth || y < 0 || y >= this.pixelHeight) return
    const i = (y * this.pixelWidth + x) * 4
    layer.data[i] = r; layer.data[i + 1] = g; layer.data[i + 2] = b; layer.data[i + 3] = a
  }

  erasePixel(layer: WebGLLayer, x: number, y: number): void {
    this.drawPixel(layer, x, y, 0, 0, 0, 0)
  }

  samplePixel(layer: WebGLLayer, x: number, y: number): [number, number, number, number] {
    const i = (y * this.pixelWidth + x) * 4
    return [layer.data[i], layer.data[i + 1], layer.data[i + 2], layer.data[i + 3]]
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  render(layers: WebGLLayer[]): void {
    const { gl, pixelWidth: w, pixelHeight: h } = this

    // 1. Clear ping-pong buffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb0)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // 2. Composite layers bottom-up into fb0 using fb1 as the "previous" result
    let srcFb = this.fb1;  let srcTex = this.fbTex1
    let dstFb = this.fb0;  let dstTex = this.fbTex0

    for (const layer of layers) {
      if (!layer.visible || layer.opacity === 0) continue
      this.compositeLayer(layer, srcTex, dstFb, w, h)
      // swap
      ;[srcFb, dstFb] = [dstFb, srcFb]
      ;[srcTex, dstTex] = [dstTex, srcTex]
    }

    // srcTex now holds the fully composited image
    const finalTex = srcTex

    // 3. Render to screen: checkerboard then blit composited result
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    this.renderCheckerboard(w, h)

    // Blit final composited texture over checkerboard using standard alpha blend
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    this.blitTexture(finalTex, w, h)
    gl.disable(gl.BLEND)
  }

  private compositeLayer(
    layer: WebGLLayer,
    dstTex: WebGLTexture,
    targetFb: WebGLFramebuffer,
    w: number,
    h: number
  ): void {
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFb)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.imageProgram)
    gl.disable(gl.BLEND)

    gl.uniform2f(gl.getUniformLocation(this.imageProgram, 'u_resolution'), w, h)
    gl.uniform1f(gl.getUniformLocation(this.imageProgram, 'u_opacity'), layer.opacity)
    gl.uniform1i(gl.getUniformLocation(this.imageProgram, 'u_blendMode'), BLEND_MODE_INDEX[layer.blendMode] ?? 0)
    gl.uniformMatrix3fv(gl.getUniformLocation(this.imageProgram, 'u_transform'), false, [1,0,0, 0,1,0, 0,0,1])

    const posLoc = gl.getAttribLocation(this.imageProgram, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    fillRectBuffer(gl, 0, 0, w, h)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const texLoc = gl.getAttribLocation(this.imageProgram, 'a_texCoord')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(texLoc)
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0)

    // u_image = current layer (src)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, layer.texture)
    gl.uniform1i(gl.getUniformLocation(this.imageProgram, 'u_image'), 0)

    // u_dst = composited result so far
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, dstTex)
    gl.uniform1i(gl.getUniformLocation(this.imageProgram, 'u_dst'), 1)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private blitTexture(tex: WebGLTexture, w: number, h: number): void {
    const { gl } = this
    gl.useProgram(this.blitProgram)
    gl.uniform2f(gl.getUniformLocation(this.blitProgram, 'u_resolution'), w, h)

    const posLoc = gl.getAttribLocation(this.blitProgram, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    fillRectBuffer(gl, 0, 0, w, h)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const texLoc = gl.getAttribLocation(this.blitProgram, 'a_texCoord')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(texLoc)
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(this.blitProgram, 'u_tex'), 0)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private renderCheckerboard(w: number, h: number): void {
    const { gl } = this
    gl.useProgram(this.checkerProgram)

    gl.uniform1f(gl.getUniformLocation(this.checkerProgram, 'u_tileSize'), 8)
    gl.uniform3f(gl.getUniformLocation(this.checkerProgram, 'u_colorA'), 0.549, 0.549, 0.549)
    gl.uniform3f(gl.getUniformLocation(this.checkerProgram, 'u_colorB'), 0.392, 0.392, 0.392)
    gl.uniform2f(gl.getUniformLocation(this.checkerProgram, 'u_resolution'), w, h)

    const posLoc = gl.getAttribLocation(this.checkerProgram, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    fillRectBuffer(gl, 0, 0, w, h)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  // ─── Flatten / export ──────────────────────────────────────────────────────

  /**
   * Composite `layers` without the checkerboard and return the raw RGBA pixels
   * (top-row-first, suitable for ImageData / canvas export).
   *
   * This runs the same ping-pong compositing used by `render()` but writes
   * into the existing framebuffers and reads back via `readPixels`.  WebGL
   * stores rows bottom-up, so the result is flipped before returning.
   */
  readFlattenedPixels(layers: WebGLLayer[]): Uint8Array {
    const { gl, pixelWidth: w, pixelHeight: h } = this

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb0)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    let srcFb = this.fb1; let srcTex = this.fbTex1
    let dstFb = this.fb0; let dstTex = this.fbTex0

    for (const layer of layers) {
      if (!layer.visible || layer.opacity === 0) continue
      this.compositeLayer(layer, srcTex, dstFb, w, h)
      ;[srcFb, dstFb] = [dstFb, srcFb]
      ;[srcTex, dstTex] = [dstTex, srcTex]
    }

    // Read back from the framebuffer that holds the final composite.
    gl.bindFramebuffer(gl.FRAMEBUFFER, srcFb)
    const pixels = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    // WebGL rows are stored bottom-up — flip vertically.
    const rowBytes = w * 4
    const tmp = new Uint8Array(rowBytes)
    for (let y = 0; y < Math.floor(h / 2); y++) {
      const topOff = y * rowBytes
      const botOff = (h - 1 - y) * rowBytes
      tmp.set(pixels.subarray(topOff, topOff + rowBytes))
      pixels.copyWithin(topOff, botOff, botOff + rowBytes)
      pixels.set(tmp, botOff)
    }

    return pixels
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  resize(_canvasWidth: number, _canvasHeight: number): void {}

  destroy(): void {
    const { gl } = this
    gl.deleteProgram(this.imageProgram)
    gl.deleteProgram(this.checkerProgram)
    gl.deleteProgram(this.blitProgram)
    gl.deleteBuffer(this.posBuffer)
    gl.deleteBuffer(this.texCoordBuffer)
    gl.deleteFramebuffer(this.fb0)
    gl.deleteFramebuffer(this.fb1)
    gl.deleteTexture(this.fbTex0)
    gl.deleteTexture(this.fbTex1)
  }
}


