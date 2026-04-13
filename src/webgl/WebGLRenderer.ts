import {
  compileShader,
  linkProgram,
  createPixelTexture,
  uploadTextureData,
  createStaticBuffer,
  fillRectBuffer
} from './utils'
import { IMAGE_VERT, IMAGE_FRAG, CHECKER_VERT, CHECKER_FRAG, BLIT_VERT, BLIT_FRAG, FBO_BLIT_VERT } from './shaders'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebGLLayer {
  id: string
  name: string
  texture: WebGLTexture
  data: Uint8Array
  /** Width of this layer's pixel buffer (may differ from canvas width). */
  layerWidth: number
  /** Height of this layer's pixel buffer (may differ from canvas height). */
  layerHeight: number
  /** Canvas-space X position of the layer's top-left pixel. */
  offsetX: number
  /** Canvas-space Y position of the layer's top-left pixel. */
  offsetY: number
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
  private readonly fbBlitProgram: WebGLProgram
  private readonly posBuffer: WebGLBuffer
  private readonly texCoordBuffer: WebGLBuffer
  // Two framebuffers for ping-pong compositing
  private fb0: WebGLFramebuffer
  private fb1: WebGLFramebuffer
  private fbTex0: WebGLTexture
  private fbTex1: WebGLTexture
  readonly pixelWidth: number
  readonly pixelHeight: number
  /**
   * When true, flushLayer() skips the GPU texture upload.
   * Set this before processing a batch of coalesced pointer events so only
   * CPU drawing accumulates, then reset and call flushLayer once at the end.
   */
  deferFlush = false

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
    this.fbBlitProgram = linkProgram(
      gl,
      compileShader(gl, gl.VERTEX_SHADER, FBO_BLIT_VERT),
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

  /**
   * Create a new layer. By default uses canvas dimensions centered at (0,0)
   * offset. Pass explicit lw/lh/ox/oy for sparse / offset layers.
   */
  createLayer(
    id: string,
    name: string,
    lw = this.pixelWidth,
    lh = this.pixelHeight,
    ox = 0,
    oy = 0,
  ): WebGLLayer {
    const { gl } = this
    const data = new Uint8Array(lw * lh * 4)
    const texture = createPixelTexture(gl, lw, lh, data)
    return { id, name, texture, data, layerWidth: lw, layerHeight: lh, offsetX: ox, offsetY: oy, opacity: 1, visible: true, blendMode: 'normal' }
  }

  flushLayer(layer: WebGLLayer): void {
    if (this.deferFlush) return
    uploadTextureData(this.gl, layer.texture, layer.layerWidth, layer.layerHeight, layer.data)
  }

  destroyLayer(layer: WebGLLayer): void {
    this.gl.deleteTexture(layer.texture)
  }

  /**
   * Grow a layer's backing buffer so it covers canvas coords (targetX, targetY).
   * The new size is the current size doubled (in each axis independently) until
   * the target falls within bounds, with the origin kept at canvas-center.
   * Existing pixel data is copied into the new (larger) buffer correctly.
   * Returns true if growth actually happened, false if already within bounds.
   */
  growLayerToFit(layer: WebGLLayer, canvasX: number, canvasY: number, extraRadius = 0): boolean {
    const { gl } = this
    // Layer-local coords of the target
    const lx = canvasX - layer.offsetX - extraRadius
    const ly = canvasY - layer.offsetY - extraRadius
    const rx = canvasX - layer.offsetX + extraRadius
    const ry = canvasY - layer.offsetY + extraRadius

    const fitsX = lx >= 0 && rx < layer.layerWidth
    const fitsY = ly >= 0 && ry < layer.layerHeight
    if (fitsX && fitsY) return false

    // Compute canvas center (anchor for all layer growth)
    const cx = this.pixelWidth  / 2
    const cy = this.pixelHeight / 2

    // New layer bounds start from current bounds
    let newX = layer.offsetX
    let newY = layer.offsetY
    let newW = layer.layerWidth
    let newH = layer.layerHeight

    if (!fitsX) {
      // Double width until the target is inside, keeping canvas center
      while (canvasX - extraRadius < newX || canvasX + extraRadius >= newX + newW) {
        newW *= 2
        newX = Math.round(cx - newW / 2)
      }
    }
    if (!fitsY) {
      while (canvasY - extraRadius < newY || canvasY + extraRadius >= newY + newH) {
        newH *= 2
        newY = Math.round(cy - newH / 2)
      }
    }

    // Copy old pixel data into the new buffer at the correct offset
    const copyX = layer.offsetX - newX
    const copyY = layer.offsetY - newY
    const newData = new Uint8Array(newW * newH * 4)
    for (let row = 0; row < layer.layerHeight; row++) {
      const srcOff = row * layer.layerWidth * 4
      const dstOff = ((copyY + row) * newW + copyX) * 4
      newData.set(layer.data.subarray(srcOff, srcOff + layer.layerWidth * 4), dstOff)
    }

    // Recreate GPU texture
    gl.deleteTexture(layer.texture)
    layer.texture   = createPixelTexture(gl, newW, newH, newData)
    layer.data      = newData
    layer.layerWidth  = newW
    layer.layerHeight = newH
    layer.offsetX   = newX
    layer.offsetY   = newY
    return true
  }

  // ─── Pixel operations (layer-local coords) ────────────────────────────────

  drawPixel(layer: WebGLLayer, x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= layer.layerWidth || y < 0 || y >= layer.layerHeight) return
    const i = (y * layer.layerWidth + x) * 4
    layer.data[i] = r; layer.data[i + 1] = g; layer.data[i + 2] = b; layer.data[i + 3] = a
  }

  erasePixel(layer: WebGLLayer, x: number, y: number): void {
    this.drawPixel(layer, x, y, 0, 0, 0, 0)
  }

  samplePixel(layer: WebGLLayer, x: number, y: number): [number, number, number, number] {
    if (x < 0 || x >= layer.layerWidth || y < 0 || y >= layer.layerHeight) return [0, 0, 0, 0]
    const i = (y * layer.layerWidth + x) * 4
    return [layer.data[i], layer.data[i + 1], layer.data[i + 2], layer.data[i + 3]]
  }

  /**
   * Convert canvas-space coordinates to layer-local coordinates.
   * Returns null if the point is outside the layer's current buffer.
   */
  canvasToLayer(layer: WebGLLayer, canvasX: number, canvasY: number): { x: number; y: number } | null {
    const lx = canvasX - layer.offsetX
    const ly = canvasY - layer.offsetY
    if (lx < 0 || ly < 0 || lx >= layer.layerWidth || ly >= layer.layerHeight) return null
    return { x: lx, y: ly }
  }

  /**
   * Convert canvas-space coordinates to layer-local coordinates WITHOUT bounds check.
   * Use when you know the layer has already been grown to fit.
   */
  canvasToLayerUnchecked(layer: WebGLLayer, canvasX: number, canvasY: number): { x: number; y: number } {
    return { x: canvasX - layer.offsetX, y: canvasY - layer.offsetY }
  }

  /**
   * Sample a pixel in canvas coordinates (auto-translates to layer-local).
   * Returns transparent if outside layer bounds.
   */
  sampleCanvasPixel(layer: WebGLLayer, canvasX: number, canvasY: number): [number, number, number, number] {
    const lx = canvasX - layer.offsetX
    const ly = canvasY - layer.offsetY
    return this.samplePixel(layer, lx, ly)
  }

  /**
   * Draw a pixel in canvas coordinates (auto-translates to layer-local).
   * Does nothing if outside layer bounds — caller must growLayerToFit first.
   */
  drawCanvasPixel(layer: WebGLLayer, canvasX: number, canvasY: number, r: number, g: number, b: number, a: number): void {
    this.drawPixel(layer, canvasX - layer.offsetX, canvasY - layer.offsetY, r, g, b, a)
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
    srcTex: WebGLTexture,
    targetFb: WebGLFramebuffer,
    w: number,
    h: number
  ): void {
    const { gl } = this

    // Step 1: copy srcTex (previous composite result) into targetFb so that
    // pixels outside the layer's rect are preserved.
    // Use fbBlitProgram (no Y-flip) — this is an FBO-to-FBO copy and both
    // FBOs share the same orientation; BLIT_VERT's Y-flip is only for screen output.
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFb)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.fbBlitProgram)
    gl.uniform2f(gl.getUniformLocation(this.fbBlitProgram, 'u_resolution'), w, h)
    const bPosLoc = gl.getAttribLocation(this.fbBlitProgram, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    fillRectBuffer(gl, 0, 0, w, h)
    gl.enableVertexAttribArray(bPosLoc)
    gl.vertexAttribPointer(bPosLoc, 2, gl.FLOAT, false, 0, 0)
    const bTexLoc = gl.getAttribLocation(this.fbBlitProgram, 'a_texCoord')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(bTexLoc)
    gl.vertexAttribPointer(bTexLoc, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.uniform1i(gl.getUniformLocation(this.fbBlitProgram, 'u_tex'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    // Step 2: composite the layer's texture over just its rect using the blend
    // shader. u_dst reads from srcTex; output writes to the layer's sub-rect in targetFb.
    const ox = layer.offsetX
    const oy = layer.offsetY
    const lw = layer.layerWidth
    const lh = layer.layerHeight

    gl.useProgram(this.imageProgram)
    gl.disable(gl.BLEND)

    gl.uniform2f(gl.getUniformLocation(this.imageProgram, 'u_resolution'), w, h)
    gl.uniform1f(gl.getUniformLocation(this.imageProgram, 'u_opacity'), layer.opacity)
    gl.uniform1i(gl.getUniformLocation(this.imageProgram, 'u_blendMode'), BLEND_MODE_INDEX[layer.blendMode] ?? 0)
    gl.uniformMatrix3fv(gl.getUniformLocation(this.imageProgram, 'u_transform'), false, [1,0,0, 0,1,0, 0,0,1])

    // Position quad covering only the layer's canvas-space rect
    const posLoc = gl.getAttribLocation(this.imageProgram, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    fillRectBuffer(gl, ox, oy, lw, lh)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    // Tex coords for the layer texture: full [0,1]x[0,1]
    const texLoc = gl.getAttribLocation(this.imageProgram, 'a_texCoord')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(texLoc)
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0)

    // u_image = current layer (src)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, layer.texture)
    gl.uniform1i(gl.getUniformLocation(this.imageProgram, 'u_image'), 0)

    // u_dst = previous composite result; shader samples it at v_texCoord.
    // But v_texCoord is [0,1] over the layer's sub-rect, while u_dst covers
    // the full canvas. We pass the layer's normalized rect so the shader can
    // remap. We do this via the u_transform uniform repurposed as a UV-offset
    // matrix for the dst: actually, the existing shader samples u_dst at
    // v_texCoord directly — which doesn't work for sub-rects.
    // Solution: pass u_dst as a full-canvas texture and sample it by mapping
    // v_texCoord (layer-local [0,1]) back to canvas [0,1].
    // We pass a separate uniform for the dst UV remap:
    gl.uniform4f(
      gl.getUniformLocation(this.imageProgram, 'u_dstRect'),
      ox / w,          // x offset in [0,1] canvas UV
      oy / h,          // y offset in [0,1] canvas UV
      lw / w,          // width in canvas UV
      lh / h,          // height in canvas UV
    )
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
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

  // ─── Pixel read API ────────────────────────────────────────────────────────
  //
  // COORDINATE CONVENTION: all methods below return (and accept) pixel data in
  // top-to-bottom, left-to-right order — index 0 = top-left pixel.  This is
  // the same convention used by ImageData, canvas 2d, and the CPU-side
  // layer.data buffers.
  //
  // Why no flip needed from readPixels:
  //   IMAGE_VERT renders to the FBO without a Y-flip, so FBO raster row 0
  //   (bottom) receives the data from layer.data row 0 (= image top).
  //   gl.readPixels reads from raster row 0 upward, so output row 0 = image
  //   top.  An extra flip would invert a correct result, which is the bug we
  //   are explicitly NOT doing here.

  /**
   * Return a copy of a single layer's raw RGBA pixels in top-to-bottom order.
   * Cheap — just slices the CPU-side buffer without any GL round-trip.
   */
  readLayerPixels(layer: WebGLLayer): Uint8Array {
    return layer.data.slice()
  }

  /**
   * Composite `layers` (respecting visibility and opacity) and return the
   * merged RGBA pixels in top-to-bottom order, suitable for ImageData / export.
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
    // No vertical flip — see coordinate convention note above.
    gl.bindFramebuffer(gl.FRAMEBUFFER, srcFb)
    const pixels = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

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


