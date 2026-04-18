import {
  createGpuTexture,
  uploadTextureData,
  uploadR8TextureData,
  createUniformBuffer,
  writeUniformBuffer,
  createReadbackBuffer,
  createVertexBuffer,
} from './utils'
import {
  COMPOSITE_SHADER,
  CHECKER_SHADER,
  BLIT_SHADER,
  BC_COMPUTE,
  HS_COMPUTE,
  VIB_COMPUTE,
  CB_COMPUTE,
  BW_COMPUTE,
  TEMP_COMPUTE,
  INVERT_COMPUTE,
  SEL_COLOR_COMPUTE,
  CURVES_COMPUTE,
  CG_COMPUTE,
} from './shaders'
import type { AdjustmentParamsMap } from '@/types'
import type { CurvesLuts } from '@/adjustments/curves'

// ─── Types ────────────────────────────────────────────────────────────────────

type ColorBalancePassParams   = AdjustmentParamsMap['color-balance']
type BlackAndWhitePassParams  = AdjustmentParamsMap['black-and-white']
type SelectiveColorPassParams = AdjustmentParamsMap['selective-color']
type CurvesPassParams         = AdjustmentParamsMap['curves']
type ColorGradingPassParams   = AdjustmentParamsMap['color-grading']

export interface GpuLayer {
  id: string
  name: string
  texture: GPUTexture
  data: Uint8Array
  layerWidth: number
  layerHeight: number
  offsetX: number
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

export type AdjustmentRenderOp =
  | { kind: 'brightness-contrast'; layerId: string; brightness: number; contrast: number; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'hue-saturation'; layerId: string; hue: number; saturation: number; lightness: number; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'color-vibrance'; layerId: string; vibrance: number; saturation: number; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'color-balance'; layerId: string; params: ColorBalancePassParams; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'black-and-white'; layerId: string; params: BlackAndWhitePassParams; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'color-temperature'; layerId: string; temperature: number; tint: number; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'color-invert'; layerId: string; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'selective-color'; layerId: string; params: SelectiveColorPassParams; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'curves'; layerId: string; params: CurvesPassParams; luts: CurvesLuts; visible: boolean; selMaskLayer?: GpuLayer }
  | { kind: 'color-grading'; layerId: string; params: ColorGradingPassParams; visible: boolean; selMaskLayer?: GpuLayer }

export type RenderPlanEntry =
  | { kind: 'layer'; layer: GpuLayer; mask?: GpuLayer }
  | {
      kind: 'adjustment-group'
      parentLayerId: string
      baseLayer: GpuLayer
      baseMask?: GpuLayer
      adjustments: AdjustmentRenderOp[]
    }
  | AdjustmentRenderOp

// ─── Error ────────────────────────────────────────────────────────────────────

export class WebGPUUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebGPUUnavailableError'
  }
}

// ─── Full-canvas quad (two triangles) ─────────────────────────────────────────

const QUAD_POSITIONS = (w: number, h: number): Float32Array =>
  new Float32Array([0, 0, w, 0, 0, h, 0, h, w, 0, w, h])

const QUAD_UVS = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class WebGPURenderer {
  private readonly device: GPUDevice
  private readonly context: GPUCanvasContext
  private readonly sampler: GPUSampler
  private readonly lutSampler: GPUSampler

  // Render pipelines
  private readonly compositePipeline: GPURenderPipeline  // renders to rgba8unorm internal textures
  private readonly checkerPipeline: GPURenderPipeline    // renders to screen (canvasFormat)
  private readonly blitPipeline: GPURenderPipeline       // renders to screen (canvasFormat)
  private readonly fboBlitPipeline: GPURenderPipeline    // renders to rgba8unorm internal textures

  // Compute pipelines
  private readonly bcPipeline: GPUComputePipeline
  private readonly hsPipeline: GPUComputePipeline
  private readonly vibPipeline: GPUComputePipeline
  private readonly cbPipeline: GPUComputePipeline
  private readonly bwPipeline: GPUComputePipeline
  private readonly tempPipeline: GPUComputePipeline
  private readonly invertPipeline: GPUComputePipeline
  private readonly selColorPipeline: GPUComputePipeline
  private readonly curvesPipeline: GPUComputePipeline
  private readonly cgPipeline: GPUComputePipeline

  // Shared vertex/tex-coord buffers
  private readonly texCoordBuffer: GPUBuffer

  // Ping-pong textures
  private pingTex: GPUTexture
  private pongTex: GPUTexture
  private groupPingTex: GPUTexture
  private groupPongTex: GPUTexture

  // Curves LUT cache
  private readonly curvesLutTextures = new Map<string, { rgb: GPUTexture; red: GPUTexture; green: GPUTexture; blue: GPUTexture }>()
  private readonly curvesLutSignatures = new Map<string, string>()

  // Temporary GPU buffers accumulated during command encoding; flushed after submit.
  private pendingDestroyBuffers: GPUBuffer[] = []

  readonly pixelWidth: number
  readonly pixelHeight: number
  deferFlush = false

  // ─── Factory ────────────────────────────────────────────────────────────────

  static async create(
    canvas: HTMLCanvasElement,
    pixelWidth: number,
    pixelHeight: number,
  ): Promise<WebGPURenderer> {
    if (!navigator.gpu) {
      throw new WebGPUUnavailableError(
        'WebGPU is not available in this environment. PixelShop requires WebGPU to run.'
      )
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) {
      throw new WebGPUUnavailableError(
        'WebGPU adapter could not be obtained. Your GPU driver may not support WebGPU.'
      )
    }
    const device = await adapter.requestDevice()
    const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!ctx) {
      throw new WebGPUUnavailableError('Failed to obtain WebGPU canvas context.')
    }
    const format = navigator.gpu.getPreferredCanvasFormat()
    ctx.configure({ device, format, alphaMode: 'premultiplied' })
    return new WebGPURenderer(device, ctx, format, pixelWidth, pixelHeight)
  }

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvasFormat: GPUTextureFormat,
    pixelWidth: number,
    pixelHeight: number,
  ) {
    this.device = device
    this.context = context
    this.pixelWidth = pixelWidth
    this.pixelHeight = pixelHeight

    // Samplers
    this.sampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.lutSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })

    // Shared vertex buffers
    this.texCoordBuffer = createVertexBuffer(device, QUAD_UVS)

    // Ping-pong textures
    const texUsage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT
    this.pingTex      = this.createPingPongTex(pixelWidth, pixelHeight, texUsage)
    this.pongTex      = this.createPingPongTex(pixelWidth, pixelHeight, texUsage)
    this.groupPingTex = this.createPingPongTex(pixelWidth, pixelHeight, texUsage)
    this.groupPongTex = this.createPingPongTex(pixelWidth, pixelHeight, texUsage)

    // Render pipelines — composite targets internal rgba8unorm textures; checker/blit target the screen
    this.compositePipeline = this.createCompositePipeline('rgba8unorm')
    this.checkerPipeline   = this.createCheckerPipeline(canvasFormat)
    this.blitPipeline      = this.createBlitPipeline(canvasFormat)
    this.fboBlitPipeline   = this.createFboBlitPipeline('rgba8unorm')

    // Compute pipelines
    this.bcPipeline       = this.createComputePipeline(BC_COMPUTE,        'cs_brightness_contrast')
    this.hsPipeline       = this.createComputePipeline(HS_COMPUTE,        'cs_hue_saturation')
    this.vibPipeline      = this.createComputePipeline(VIB_COMPUTE,       'cs_color_vibrance')
    this.cbPipeline       = this.createComputePipeline(CB_COMPUTE,        'cs_color_balance')
    this.bwPipeline       = this.createComputePipeline(BW_COMPUTE,        'cs_black_and_white')
    this.tempPipeline     = this.createComputePipeline(TEMP_COMPUTE,      'cs_color_temperature')
    this.invertPipeline   = this.createComputePipeline(INVERT_COMPUTE,    'cs_color_invert')
    this.selColorPipeline = this.createComputePipeline(SEL_COLOR_COMPUTE, 'cs_selective_color')
    this.curvesPipeline   = this.createComputePipeline(CURVES_COMPUTE,    'cs_curves')
    this.cgPipeline       = this.createComputePipeline(CG_COMPUTE,        'cs_color_grading')
  }

  // ─── Pipeline factories ─────────────────────────────────────────────────────

  private createPingPongTex(w: number, h: number, usage: GPUTextureUsageFlags): GPUTexture {
    return this.device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage,
    })
  }

  private createComputePipeline(wgsl: string, entryPoint: string): GPUComputePipeline {
    const module = this.device.createShaderModule({ code: wgsl })
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint },
    })
  }

  private createCompositePipeline(format: GPUTextureFormat): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: COMPOSITE_SHADER })
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_composite',
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_composite',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  private createCheckerPipeline(format: GPUTextureFormat): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: CHECKER_SHADER })
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_checker',
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_checker',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  private createFboBlitPipeline(format: GPUTextureFormat): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: BLIT_SHADER })
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_blit',
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_blit',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  private createBlitPipeline(format: GPUTextureFormat): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: BLIT_SHADER })
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_blit',
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_blit',
        targets: [{
          format,
          // Source-over blending for premultiplied-alpha source (straight-alpha src texture
          // is treated as premultiplied because rgba8unorm stores un-associated alpha,
          // but for Porter-Duff OVER on top of the checkerboard we need:
          //   out = src + dst * (1 - src.a)
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  // ─── Layer management ───────────────────────────────────────────────────────

  createLayer(
    id: string,
    name: string,
    lw = this.pixelWidth,
    lh = this.pixelHeight,
    ox = 0,
    oy = 0,
  ): GpuLayer {
    const data = new Uint8Array(lw * lh * 4)
    const texture = createGpuTexture(this.device, lw, lh, data)
    return { id, name, texture, data, layerWidth: lw, layerHeight: lh, offsetX: ox, offsetY: oy, opacity: 1, visible: true, blendMode: 'normal' }
  }

  flushLayer(layer: GpuLayer): void {
    if (this.deferFlush) return
    uploadTextureData(this.device, layer.texture, layer.layerWidth, layer.layerHeight, layer.data)
  }

  destroyLayer(layer: GpuLayer): void {
    layer.texture.destroy()
  }

  growLayerToFit(layer: GpuLayer, canvasX: number, canvasY: number, extraRadius = 0): boolean {
    const lx = canvasX - layer.offsetX - extraRadius
    const ly = canvasY - layer.offsetY - extraRadius
    const rx = canvasX - layer.offsetX + extraRadius
    const ry = canvasY - layer.offsetY + extraRadius

    const fitsX = lx >= 0 && rx < layer.layerWidth
    const fitsY = ly >= 0 && ry < layer.layerHeight
    if (fitsX && fitsY) return false

    const cx = this.pixelWidth  / 2
    const cy = this.pixelHeight / 2

    let newX = layer.offsetX
    let newY = layer.offsetY
    let newW = layer.layerWidth
    let newH = layer.layerHeight

    if (!fitsX) {
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

    const copyX = layer.offsetX - newX
    const copyY = layer.offsetY - newY
    const newData = new Uint8Array(newW * newH * 4)
    for (let row = 0; row < layer.layerHeight; row++) {
      const srcOff = row * layer.layerWidth * 4
      const dstOff = ((copyY + row) * newW + copyX) * 4
      newData.set(layer.data.subarray(srcOff, srcOff + layer.layerWidth * 4), dstOff)
    }

    // Copy old texture data into new texture using WebGPU
    const newTex = createGpuTexture(this.device, newW, newH, newData)

    layer.texture.destroy()
    layer.texture    = newTex
    layer.data       = newData
    layer.layerWidth  = newW
    layer.layerHeight = newH
    layer.offsetX    = newX
    layer.offsetY    = newY
    return true
  }

  // ─── Pixel operations (CPU-side, layer-local coords) ────────────────────────

  drawPixel(layer: GpuLayer, x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= layer.layerWidth || y < 0 || y >= layer.layerHeight) return
    const i = (y * layer.layerWidth + x) * 4
    layer.data[i] = r; layer.data[i + 1] = g; layer.data[i + 2] = b; layer.data[i + 3] = a
  }

  erasePixel(layer: GpuLayer, x: number, y: number): void {
    this.drawPixel(layer, x, y, 0, 0, 0, 0)
  }

  samplePixel(layer: GpuLayer, x: number, y: number): [number, number, number, number] {
    if (x < 0 || x >= layer.layerWidth || y < 0 || y >= layer.layerHeight) return [0, 0, 0, 0]
    const i = (y * layer.layerWidth + x) * 4
    return [layer.data[i], layer.data[i + 1], layer.data[i + 2], layer.data[i + 3]]
  }

  canvasToLayer(layer: GpuLayer, canvasX: number, canvasY: number): { x: number; y: number } | null {
    const lx = canvasX - layer.offsetX
    const ly = canvasY - layer.offsetY
    if (lx < 0 || ly < 0 || lx >= layer.layerWidth || ly >= layer.layerHeight) return null
    return { x: lx, y: ly }
  }

  canvasToLayerUnchecked(layer: GpuLayer, canvasX: number, canvasY: number): { x: number; y: number } {
    return { x: canvasX - layer.offsetX, y: canvasY - layer.offsetY }
  }

  sampleCanvasPixel(layer: GpuLayer, canvasX: number, canvasY: number): [number, number, number, number] {
    return this.samplePixel(layer, canvasX - layer.offsetX, canvasY - layer.offsetY)
  }

  drawCanvasPixel(layer: GpuLayer, canvasX: number, canvasY: number, r: number, g: number, b: number, a: number): void {
    this.drawPixel(layer, canvasX - layer.offsetX, canvasY - layer.offsetY, r, g, b, a)
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  render(layers: GpuLayer[], maskMap?: Map<string, GpuLayer>): void {
    const plan: RenderPlanEntry[] = layers.map(layer => ({
      kind: 'layer' as const,
      layer,
      mask: maskMap?.get(layer.id),
    }))
    this.renderPlan(plan)
  }

  renderPlan(plan: RenderPlanEntry[]): void {
    const { device } = this
    const encoder = device.createCommandEncoder()

    const finalTex = this.encodePlanToComposite(encoder, plan)

    // Render to screen: checkerboard + blit
    const screenView = this.context.getCurrentTexture().createView()
    this.encodeCheckerboard(encoder, screenView)
    this.encodeBlitToView(encoder, finalTex, screenView)

    device.queue.submit([encoder.finish()])
    this.flushPendingDestroys()
  }

  // ─── Flatten / readback ─────────────────────────────────────────────────────

  readLayerPixels(layer: GpuLayer): Uint8Array {
    return layer.data.slice()
  }

  async readFlattenedPixels(layers: GpuLayer[], maskMap?: Map<string, GpuLayer>): Promise<Uint8Array> {
    const plan: RenderPlanEntry[] = layers.map(layer => ({
      kind: 'layer' as const,
      layer,
      mask: maskMap?.get(layer.id),
    }))
    return this.readFlattenedPlan(plan)
  }

  async readFlattenedPlan(plan: RenderPlanEntry[]): Promise<Uint8Array> {
    const { device, pixelWidth: w, pixelHeight: h } = this
    const encoder = device.createCommandEncoder()
    const finalTex = this.encodePlanToComposite(encoder, plan)

    const byteSize = w * h * 4
    const readbuf = createReadbackBuffer(device, byteSize)
    encoder.copyTextureToBuffer(
      { texture: finalTex },
      { buffer: readbuf, bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )
    device.queue.submit([encoder.finish()])
    this.flushPendingDestroys()

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = new Uint8Array(readbuf.getMappedRange()).slice()
    readbuf.unmap()
    readbuf.destroy()
    return result
  }

  async readAdjustmentInputPlan(plan: RenderPlanEntry[], adjustmentLayerId: string): Promise<Uint8Array | null> {
    const groupEntry = plan.find(
      (entry): entry is Extract<RenderPlanEntry, { kind: 'adjustment-group' }> =>
        entry.kind === 'adjustment-group' &&
        entry.adjustments.some(op => op.layerId === adjustmentLayerId)
    )
    if (!groupEntry) return null

    const targetIndex = groupEntry.adjustments.findIndex(op => op.layerId === adjustmentLayerId)
    if (targetIndex < 0) return null

    const { device, pixelWidth: w, pixelHeight: h } = this
    const encoder = device.createCommandEncoder()

    // Clear group textures
    this.encodeClearTexture(encoder, this.groupPingTex)
    this.encodeClearTexture(encoder, this.groupPongTex)

    let srcTex = this.groupPongTex
    let dstTex = this.groupPingTex

    const baseAsSource: GpuLayer = { ...groupEntry.baseLayer, opacity: 1, blendMode: 'normal' }
    this.encodeCompositeLayer(encoder, baseAsSource, srcTex, dstTex, groupEntry.baseMask)
    ;[srcTex, dstTex] = [dstTex, srcTex]

    for (let i = 0; i < targetIndex; i++) {
      const op = groupEntry.adjustments[i]
      if (!op.visible) continue
      this.encodeAdjustmentOp(encoder, op, srcTex, dstTex)
      ;[srcTex, dstTex] = [dstTex, srcTex]
    }

    const byteSize = w * h * 4
    const readbuf = createReadbackBuffer(device, byteSize)
    encoder.copyTextureToBuffer(
      { texture: srcTex },
      { buffer: readbuf, bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )
    device.queue.submit([encoder.finish()])
    this.flushPendingDestroys()

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = new Uint8Array(readbuf.getMappedRange()).slice()
    readbuf.unmap()
    readbuf.destroy()
    return result
  }

  // ─── Plan execution ─────────────────────────────────────────────────────────

  private encodePlanToComposite(
    encoder: GPUCommandEncoder,
    plan: RenderPlanEntry[],
  ): GPUTexture {
    this.encodeClearTexture(encoder, this.pingTex)
    this.encodeClearTexture(encoder, this.pongTex)

    let src = this.pongTex
    let dst = this.pingTex

    for (const entry of plan) {
      if (entry.kind === 'layer') {
        if (!entry.layer.visible || entry.layer.opacity === 0) continue
        this.encodeCompositeLayer(encoder, entry.layer, src, dst, entry.mask)
      } else if (entry.kind === 'adjustment-group') {
        if (!entry.baseLayer.visible || entry.baseLayer.opacity === 0) continue
        const groupResult = this.encodeAdjustmentGroup(encoder, entry)
        this.encodeCompositeTexture(encoder, groupResult, src, dst, entry.baseLayer.opacity, entry.baseLayer.blendMode)
      } else {
        if (!entry.visible) continue
        this.encodeAdjustmentOp(encoder, entry, src, dst)
      }
      ;[src, dst] = [dst, src]
    }

    return src
  }

  private encodeClearTexture(encoder: GPUCommandEncoder, texture: GPUTexture): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    })
    pass.end()
  }

  private encodeCheckerboard(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    const { device, pixelWidth: w, pixelHeight: h } = this

    // WGSL CheckerUniforms layout (64 bytes):
    //   offset  0: tileSize   : f32
    //   offset 16: colorA     : vec3f  (align 16)
    //   offset 28: _pad0      : f32
    //   offset 32: colorB     : vec3f  (align 16)
    //   offset 44: _pad1      : f32
    //   offset 48: resolution : vec2f  (align 8)
    //   offset 56: _pad2      : vec2f
    //   total: 64 bytes
    const uniformBuf = createUniformBuffer(device, 64)
    const uniformView = new DataView(new ArrayBuffer(64))
    uniformView.setFloat32( 0, 8.0, true)    // tileSize
    uniformView.setFloat32(16, 0.549, true); uniformView.setFloat32(20, 0.549, true); uniformView.setFloat32(24, 0.549, true) // colorA
    uniformView.setFloat32(28, 0.0, true)    // _pad0
    uniformView.setFloat32(32, 0.392, true); uniformView.setFloat32(36, 0.392, true); uniformView.setFloat32(40, 0.392, true) // colorB
    uniformView.setFloat32(44, 0.0, true)    // _pad1
    uniformView.setFloat32(48, w, true);     uniformView.setFloat32(52, h, true)      // resolution
    writeUniformBuffer(device, uniformBuf, uniformView.buffer)

    const posBuffer = createVertexBuffer(device, QUAD_POSITIONS(w, h))

    const bindGroup = device.createBindGroup({
      layout: this.checkerPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
    })

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    })
    pass.setPipeline(this.checkerPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, posBuffer)
    pass.setVertexBuffer(1, this.texCoordBuffer)
    pass.draw(6)
    pass.end()

    this.pendingDestroyBuffers.push(uniformBuf, posBuffer)
  }

  private encodeBlitToView(encoder: GPUCommandEncoder, srcTex: GPUTexture, view: GPUTextureView): void {
    const { device, pixelWidth: w, pixelHeight: h } = this

    const uniformData = new Float32Array([w, h, 0.0, 0.0])
    const uniformBuf = createUniformBuffer(device, uniformData.byteLength)
    writeUniformBuffer(device, uniformBuf, uniformData)

    const posBuffer = createVertexBuffer(device, QUAD_POSITIONS(w, h))

    const bindGroup = device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: srcTex.createView() },
        { binding: 2, resource: { buffer: uniformBuf } },
      ],
    })

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        loadOp: 'load',
        storeOp: 'store',
      }],
    })
    pass.setPipeline(this.blitPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, posBuffer)
    pass.setVertexBuffer(1, this.texCoordBuffer)
    pass.draw(6)
    pass.end()

    this.pendingDestroyBuffers.push(uniformBuf, posBuffer)
  }

  private encodeBlitTexToTex(encoder: GPUCommandEncoder, srcTex: GPUTexture, dstTex: GPUTexture): void {
    const { device, pixelWidth: w, pixelHeight: h } = this

    const uniformData = new Float32Array([w, h, 0.0, 0.0])
    const uniformBuf = createUniformBuffer(device, uniformData.byteLength)
    writeUniformBuffer(device, uniformBuf, uniformData)

    const posBuffer = createVertexBuffer(device, QUAD_POSITIONS(w, h))

    const bindGroup = device.createBindGroup({
      layout: this.fboBlitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: srcTex.createView() },
        { binding: 2, resource: { buffer: uniformBuf } },
      ],
    })

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: dstTex.createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    })
    pass.setPipeline(this.fboBlitPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, posBuffer)
    pass.setVertexBuffer(1, this.texCoordBuffer)
    pass.draw(6)
    pass.end()

    this.pendingDestroyBuffers.push(uniformBuf, posBuffer)
  }

  private encodeCompositeLayer(
    encoder: GPUCommandEncoder,
    layer: GpuLayer,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
    maskLayer?: GpuLayer,
  ): void {
    const { device, pixelWidth: w, pixelHeight: h } = this
    const ox = layer.offsetX
    const oy = layer.offsetY
    const lw = layer.layerWidth
    const lh = layer.layerHeight

    // Step 1: FBO-blit src → dst to fill pixels outside layer rect
    this.encodeBlitTexToTex(encoder, srcTex, dstTex)

    // Step 2: Composite the layer's texture over its sub-rect
    // WGSL CompositeUniforms layout (64 bytes):
    //   offset  0: opacity    : f32
    //   offset  4: blendMode  : u32
    //   offset  8: (pad to align dstRect to 16)
    //   offset 16: dstRect    : vec4f  (4×4 = 16 bytes)
    //   offset 32: hasMask    : u32
    //   offset 36: (pad to align _pad to 16)
    //   offset 48: _pad       : vec3u  (12 bytes)
    //   total size: 64 bytes
    const unifBuf = createUniformBuffer(device, 64)
    const unifView = new DataView(new ArrayBuffer(64))
    unifView.setFloat32( 0, layer.opacity, true)
    unifView.setUint32 ( 4, BLEND_MODE_INDEX[layer.blendMode] ?? 0, true)
    unifView.setFloat32(16, ox / w, true)  // dstRect.x
    unifView.setFloat32(20, oy / h, true)  // dstRect.y
    unifView.setFloat32(24, lw / w, true)  // dstRect.z
    unifView.setFloat32(28, lh / h, true)  // dstRect.w
    unifView.setUint32 (32, maskLayer ? 1 : 0, true)
    // _pad at offset 48: left as zero

    const resUnifBuf = createUniformBuffer(device, 16)
    const resData = new Float32Array([w, h, 0, 0])
    writeUniformBuffer(device, unifBuf, unifView.buffer)
    writeUniformBuffer(device, resUnifBuf, resData)

    const dummyMaskTex = maskLayer?.texture ?? srcTex // use any fallback if no mask

    const bindGroup = device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: layer.texture.createView() },
        { binding: 2, resource: srcTex.createView() },
        { binding: 3, resource: dummyMaskTex.createView() },
        { binding: 4, resource: { buffer: unifBuf } },
        { binding: 5, resource: { buffer: resUnifBuf } },
      ],
    })

    // Position quad covering only the layer's canvas-space rect
    const posBuffer = createVertexBuffer(
      device,
      new Float32Array([
        ox,      oy,
        ox + lw, oy,
        ox,      oy + lh,
        ox,      oy + lh,
        ox + lw, oy,
        ox + lw, oy + lh,
      ])
    )

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: dstTex.createView(),
        loadOp: 'load',
        storeOp: 'store',
      }],
    })
    pass.setPipeline(this.compositePipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, posBuffer)
    pass.setVertexBuffer(1, this.texCoordBuffer)
    pass.draw(6)
    pass.end()

    this.pendingDestroyBuffers.push(unifBuf, resUnifBuf, posBuffer)
  }

  private encodeCompositeTexture(
    encoder: GPUCommandEncoder,
    texture: GPUTexture,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
    opacity: number,
    blendMode: string,
  ): void {
    const pseudoLayer: GpuLayer = {
      id: '__group-composite__',
      name: 'group',
      texture,
      data: new Uint8Array(0),
      layerWidth:  this.pixelWidth,
      layerHeight: this.pixelHeight,
      offsetX: 0,
      offsetY: 0,
      opacity,
      visible: true,
      blendMode,
    }
    this.encodeCompositeLayer(encoder, pseudoLayer, srcTex, dstTex)
  }

  private encodeAdjustmentGroup(
    encoder: GPUCommandEncoder,
    entry: Extract<RenderPlanEntry, { kind: 'adjustment-group' }>,
  ): GPUTexture {
    this.encodeClearTexture(encoder, this.groupPingTex)
    this.encodeClearTexture(encoder, this.groupPongTex)

    let srcTex = this.groupPongTex
    let dstTex = this.groupPingTex

    const baseAsSource: GpuLayer = { ...entry.baseLayer, opacity: 1, blendMode: 'normal' }
    this.encodeCompositeLayer(encoder, baseAsSource, srcTex, dstTex, entry.baseMask)
    ;[srcTex, dstTex] = [dstTex, srcTex]

    for (const op of entry.adjustments) {
      if (!op.visible) continue
      this.encodeAdjustmentOp(encoder, op, srcTex, dstTex)
      ;[srcTex, dstTex] = [dstTex, srcTex]
    }

    return srcTex
  }

  // ─── Adjustment compute passes ──────────────────────────────────────────────

  private encodeAdjustmentOp(
    encoder: GPUCommandEncoder,
    entry: AdjustmentRenderOp,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
  ): void {
    if (entry.kind === 'brightness-contrast') {
      const params = new Float32Array([entry.brightness, entry.contrast, 0, 0])
      this.encodeComputePass(encoder, this.bcPipeline, srcTex, dstTex, params, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'hue-saturation') {
      const params = new Float32Array([entry.hue, entry.saturation, entry.lightness, 0])
      this.encodeComputePass(encoder, this.hsPipeline, srcTex, dstTex, params, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'color-vibrance') {
      const params = new Float32Array([entry.vibrance, entry.saturation, 0, 0])
      this.encodeComputePass(encoder, this.vibPipeline, srcTex, dstTex, params, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'color-balance') {
      const p = entry.params
      // CBParams: sha_cr, sha_mg, sha_yb (3 f32), mid_cr, mid_mg, mid_yb (3 f32), hil_cr, hil_mg, hil_yb (3 f32), preserveLuminosity u32, _pad vec2u
      // Total = 9×4 + 4 + 8 = 48 bytes
      const buf = new ArrayBuffer(48)
      const f = new Float32Array(buf)
      const u = new Uint32Array(buf)
      f[0] = p.shadows.cr;    f[1] = p.shadows.mg;    f[2] = p.shadows.yb
      f[3] = p.midtones.cr;   f[4] = p.midtones.mg;   f[5] = p.midtones.yb
      f[6] = p.highlights.cr; f[7] = p.highlights.mg; f[8] = p.highlights.yb
      u[9] = p.preserveLuminosity ? 1 : 0
      this.encodeComputePassRaw(encoder, this.cbPipeline, srcTex, dstTex, buf, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'black-and-white') {
      const p = entry.params
      const params = new Float32Array([p.reds, p.yellows, p.greens, p.cyans, p.blues, p.magentas, 0, 0])
      this.encodeComputePass(encoder, this.bwPipeline, srcTex, dstTex, params, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'color-temperature') {
      const params = new Float32Array([entry.temperature, entry.tint, 0, 0])
      this.encodeComputePass(encoder, this.tempPipeline, srcTex, dstTex, params, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'color-invert') {
      const params = new Float32Array([0, 0, 0, 0])
      this.encodeComputePass(encoder, this.invertPipeline, srcTex, dstTex, params, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'selective-color') {
      this.encodeSelectiveColorPass(encoder, srcTex, dstTex, entry.params, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'curves') {
      this.encodeCurvesPass(encoder, srcTex, dstTex, entry.layerId, entry.luts, entry.selMaskLayer)
      return
    }
    if (entry.kind === 'color-grading') {
      this.encodeColorGradingPass(encoder, srcTex, dstTex, entry.params, entry.selMaskLayer)
      return
    }
    const _exhaustive: never = entry
    return _exhaustive
  }

  private encodeComputePass(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
    params: Float32Array,
    selMaskLayer?: GpuLayer,
  ): void {
    this.encodeComputePassRaw(encoder, pipeline, srcTex, dstTex, params.buffer as ArrayBuffer, selMaskLayer)
  }

  private encodeComputePassRaw(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
    paramsBuffer: ArrayBuffer,
    selMaskLayer?: GpuLayer,
  ): void {
    const { device, pixelWidth: w, pixelHeight: h } = this

    const alignedSize = Math.max(16, Math.ceil(paramsBuffer.byteLength / 16) * 16)
    const paramsBuf = createUniformBuffer(device, alignedSize)
    device.queue.writeBuffer(paramsBuf, 0, paramsBuffer)

    const maskFlagsData = new Uint32Array(8); maskFlagsData[0] = selMaskLayer ? 1 : 0
    const maskFlagsBuf = createUniformBuffer(device, 32)
    writeUniformBuffer(device, maskFlagsBuf, maskFlagsData)

    const dummyMask = selMaskLayer?.texture ?? srcTex

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: dstTex.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
        { binding: 3, resource: dummyMask.createView() },
        { binding: 4, resource: { buffer: maskFlagsBuf } },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    pass.end()

    this.pendingDestroyBuffers.push(paramsBuf, maskFlagsBuf)
  }

  private encodeSelectiveColorPass(
    encoder: GPUCommandEncoder,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
    params: SelectiveColorPassParams,
    selMaskLayer?: GpuLayer,
  ): void {
    const { device, pixelWidth: w, pixelHeight: h } = this

    const RANGE_ORDER = [
      params.reds, params.yellows, params.greens,
      params.cyans, params.blues, params.magentas,
      params.whites, params.neutrals, params.blacks,
    ] as const

    // SelectiveColorParams struct:  4 × array<vec4f,3> + u32 + vec3u = 4×48 + 16 = 208 bytes
    // array<f32,9> packed as array<vec4f,3>: 9 f32s = 36 bytes, padded to 48 by WGSL alignment
    // But in WGSL, array<vec4f, 3> = 3×16 = 48 bytes, which only holds 12 f32s
    // We pack 9 f32s into the first 9 floats of 3 vec4fs (using 12 slots, last 3 wasted)
    const buf = new ArrayBuffer(208)
    const f = new Float32Array(buf)
    const packArray9 = (offset: number, values: readonly number[]) => {
      for (let i = 0; i < 9; i++) {
        f[offset + i] = values[i]
      }
    }
    // cyan at offset 0 (3×vec4f = 12 floats = 48 bytes = indices 0..11)
    packArray9(0,  RANGE_ORDER.map(r => r.cyan))
    // magenta at offset 12
    packArray9(12, RANGE_ORDER.map(r => r.magenta))
    // yellow at offset 24
    packArray9(24, RANGE_ORDER.map(r => r.yellow))
    // black at offset 36
    packArray9(36, RANGE_ORDER.map(r => r.black))
    // relative: u32 at offset 48 (bytes 192)
    const u32View = new Uint32Array(buf)
    u32View[48] = params.mode === 'relative' ? 1 : 0

    const alignedSize = 208
    const paramsBuf = createUniformBuffer(device, alignedSize)
    device.queue.writeBuffer(paramsBuf, 0, buf)

    const maskFlagsData = new Uint32Array(8); maskFlagsData[0] = selMaskLayer ? 1 : 0
    const maskFlagsBuf = createUniformBuffer(device, 32)
    writeUniformBuffer(device, maskFlagsBuf, maskFlagsData)

    const dummyMask = selMaskLayer?.texture ?? srcTex

    const bindGroup = device.createBindGroup({
      layout: this.selColorPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: dstTex.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
        { binding: 3, resource: dummyMask.createView() },
        { binding: 4, resource: { buffer: maskFlagsBuf } },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.selColorPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    pass.end()

    this.pendingDestroyBuffers.push(paramsBuf, maskFlagsBuf)
  }

  private ensureCurvesLutTextures(
    layerId: string,
    luts: CurvesLuts,
  ): { rgb: GPUTexture; red: GPUTexture; green: GPUTexture; blue: GPUTexture } {
    const signature = `${Array.from(luts.rgb).join('.')}-${Array.from(luts.red).join('.')}-${Array.from(luts.green).join('.')}-${Array.from(luts.blue).join('.')}`
    const existing = this.curvesLutTextures.get(layerId)
    const prevSig = this.curvesLutSignatures.get(layerId)
    if (existing && prevSig === signature) return existing

    const writeLut = (data: Uint8Array): GPUTexture => {
      const tex = this.device.createTexture({
        size: { width: 256, height: 1 },
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      uploadR8TextureData(this.device, tex, 256, 1, data)
      return tex
    }

    if (existing) {
      existing.rgb.destroy()
      existing.red.destroy()
      existing.green.destroy()
      existing.blue.destroy()
    }

    const next = {
      rgb:   writeLut(luts.rgb),
      red:   writeLut(luts.red),
      green: writeLut(luts.green),
      blue:  writeLut(luts.blue),
    }
    this.curvesLutTextures.set(layerId, next)
    this.curvesLutSignatures.set(layerId, signature)
    return next
  }

  private encodeCurvesPass(
    encoder: GPUCommandEncoder,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
    layerId: string,
    luts: CurvesLuts,
    selMaskLayer?: GpuLayer,
  ): void {
    const { device, pixelWidth: w, pixelHeight: h } = this
    const textures = this.ensureCurvesLutTextures(layerId, luts)

    const metaBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, metaBuf, new Float32Array([0, 0, 0, 0]))

    const maskFlagsData = new Uint32Array(8); maskFlagsData[0] = selMaskLayer ? 1 : 0
    const maskFlagsBuf = createUniformBuffer(device, 32)
    writeUniformBuffer(device, maskFlagsBuf, maskFlagsData)

    const dummyMask = selMaskLayer?.texture ?? srcTex

    const bindGroup = device.createBindGroup({
      layout: this.curvesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: dstTex.createView() },
        { binding: 2, resource: { buffer: metaBuf } },
        { binding: 3, resource: dummyMask.createView() },
        { binding: 4, resource: { buffer: maskFlagsBuf } },
        { binding: 5, resource: this.lutSampler },
        { binding: 6, resource: textures.rgb.createView() },
        { binding: 7, resource: textures.red.createView() },
        { binding: 8, resource: textures.green.createView() },
        { binding: 9, resource: textures.blue.createView() },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.curvesPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    pass.end()

    this.pendingDestroyBuffers.push(metaBuf, maskFlagsBuf)
  }

  private encodeColorGradingPass(
    encoder: GPUCommandEncoder,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
    cgParams: ColorGradingPassParams,
    selMaskLayer?: GpuLayer,
  ): void {
    const { lift, gamma, gain, offset } = cgParams
    // CGParams: 4×vec4f + 15×f32 + 1 pad = 64 + 64 = 128 bytes
    const buf = new ArrayBuffer(128)
    const f = new Float32Array(buf)
    f[0]  = lift.r;    f[1]  = lift.g;    f[2]  = lift.b;    f[3]  = lift.master
    f[4]  = gamma.r;   f[5]  = gamma.g;   f[6]  = gamma.b;   f[7]  = gamma.master
    f[8]  = gain.r;    f[9]  = gain.g;    f[10] = gain.b;    f[11] = gain.master
    f[12] = offset.r;  f[13] = offset.g;  f[14] = offset.b;  f[15] = offset.master
    f[16] = cgParams.temp
    f[17] = cgParams.tint
    f[18] = cgParams.contrast
    f[19] = cgParams.pivot
    f[20] = cgParams.midDetail
    f[21] = cgParams.colorBoost
    f[22] = cgParams.shadows
    f[23] = cgParams.highlights
    f[24] = cgParams.saturation
    f[25] = cgParams.hue
    f[26] = cgParams.lumMix
    f[27] = 0 // _pad

    this.encodeComputePassRaw(encoder, this.cgPipeline, srcTex, dstTex, buf, selMaskLayer)
  }

  private flushPendingDestroys(): void {
    for (const buf of this.pendingDestroyBuffers) buf.destroy()
    this.pendingDestroyBuffers = []
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  destroy(): void {
    this.pingTex.destroy()
    this.pongTex.destroy()
    this.groupPingTex.destroy()
    this.groupPongTex.destroy()
    this.texCoordBuffer.destroy()
    for (const luts of this.curvesLutTextures.values()) {
      luts.rgb.destroy()
      luts.red.destroy()
      luts.green.destroy()
      luts.blue.destroy()
    }
    this.device.destroy()
  }
}
