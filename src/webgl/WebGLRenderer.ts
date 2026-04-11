import {
  compileShader,
  linkProgram,
  createPixelTexture,
  uploadTextureData,
  createStaticBuffer,
  fillRectBuffer
} from './utils'
import { IMAGE_VERT, IMAGE_FRAG, CHECKER_VERT, CHECKER_FRAG } from './shaders'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebGLLayer {
  id: string
  name: string
  texture: WebGLTexture
  data: Uint8Array
  opacity: number
  visible: boolean
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class WebGLRenderer {
  private readonly gl: WebGLRenderingContext
  private readonly imageProgram: WebGLProgram
  private readonly checkerProgram: WebGLProgram
  private readonly posBuffer: WebGLBuffer
  private readonly texCoordBuffer: WebGLBuffer
  readonly pixelWidth: number
  readonly pixelHeight: number

  constructor(canvas: HTMLCanvasElement, pixelWidth: number, pixelHeight: number) {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true
    })
    if (!gl) throw new Error('WebGL is not supported in this environment')

    this.gl = gl
    this.pixelWidth = pixelWidth
    this.pixelHeight = pixelHeight

    // Compile programs
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

    // Shared position buffer (reused per draw call via fillRectBuffer)
    const posBuffer = gl.createBuffer()
    if (!posBuffer) throw new Error('Failed to allocate position buffer')
    this.posBuffer = posBuffer

    // Static UV buffer – covers full [0,1] range
    this.texCoordBuffer = createStaticBuffer(
      gl,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
    )

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  // ─── Layer management ──────────────────────────────────────────────────────

  createLayer(id: string, name: string): WebGLLayer {
    const { gl, pixelWidth, pixelHeight } = this
    const data = new Uint8Array(pixelWidth * pixelHeight * 4)
    const texture = createPixelTexture(gl, pixelWidth, pixelHeight, data)
    return { id, name, texture, data, opacity: 1, visible: true }
  }

  flushLayer(layer: WebGLLayer): void {
    uploadTextureData(this.gl, layer.texture, this.pixelWidth, this.pixelHeight, layer.data)
  }

  destroyLayer(layer: WebGLLayer): void {
    this.gl.deleteTexture(layer.texture)
  }

  // ─── Pixel operations ──────────────────────────────────────────────────────

  drawPixel(
    layer: WebGLLayer,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): void {
    if (x < 0 || x >= this.pixelWidth || y < 0 || y >= this.pixelHeight) return
    const i = (y * this.pixelWidth + x) * 4
    layer.data[i] = r
    layer.data[i + 1] = g
    layer.data[i + 2] = b
    layer.data[i + 3] = a
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

    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    this.renderCheckerboard(w, h)

    for (const layer of layers) {
      if (!layer.visible || layer.opacity === 0) continue
      this.renderLayer(layer, w, h)
    }
  }

  private renderCheckerboard(w: number, h: number): void {
    const { gl } = this
    gl.useProgram(this.checkerProgram)

    gl.uniform1f(gl.getUniformLocation(this.checkerProgram, 'u_tileSize'), 8)
    gl.uniform3f(gl.getUniformLocation(this.checkerProgram, 'u_colorA'), 0.549, 0.549, 0.549)  // #8c8c8c
    gl.uniform3f(gl.getUniformLocation(this.checkerProgram, 'u_colorB'), 0.392, 0.392, 0.392)  // #646464
    gl.uniform2f(gl.getUniformLocation(this.checkerProgram, 'u_resolution'), w, h)

    const posLoc = gl.getAttribLocation(this.checkerProgram, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    fillRectBuffer(gl, 0, 0, w, h)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private renderLayer(layer: WebGLLayer, w: number, h: number): void {
    const { gl } = this
    gl.useProgram(this.imageProgram)

    gl.uniform2f(gl.getUniformLocation(this.imageProgram, 'u_resolution'), w, h)
    gl.uniform1f(gl.getUniformLocation(this.imageProgram, 'u_opacity'), layer.opacity)
    // Identity transform matrix (column-major)
    gl.uniformMatrix3fv(gl.getUniformLocation(this.imageProgram, 'u_transform'), false, [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ])

    const posLoc = gl.getAttribLocation(this.imageProgram, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    fillRectBuffer(gl, 0, 0, w, h)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const texLoc = gl.getAttribLocation(this.imageProgram, 'a_texCoord')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(texLoc)
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, layer.texture)
    gl.uniform1i(gl.getUniformLocation(this.imageProgram, 'u_image'), 0)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** No-op: drawing buffer is fixed at pixelWidth × pixelHeight; use CSS to zoom the element. */
  resize(_canvasWidth: number, _canvasHeight: number): void {}

  destroy(): void {
    const { gl } = this
    gl.deleteProgram(this.imageProgram)
    gl.deleteProgram(this.checkerProgram)
    gl.deleteBuffer(this.posBuffer)
    gl.deleteBuffer(this.texCoordBuffer)
  }
}
