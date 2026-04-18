import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer } from './utils'
import { FILTER_GAUSSIAN_H_COMPUTE, FILTER_GAUSSIAN_V_COMPUTE, FILTER_BOX_H_COMPUTE, FILTER_BOX_V_COMPUTE, FILTER_RADIAL_BLUR_COMPUTE, FILTER_MOTION_BLUR_COMPUTE, FILTER_LENS_BLUR_COMPUTE, FILTER_SHARPEN_COMPUTE, FILTER_SHARPEN_MORE_COMPUTE, FILTER_UNSHARP_COMBINE_COMPUTE } from './filterShaders'

// ─── Engine ───────────────────────────────────────────────────────────────────

class FilterComputeEngine {
  private readonly device: GPUDevice
  private readonly gaussianHPipeline: GPUComputePipeline
  private readonly gaussianVPipeline: GPUComputePipeline
  private readonly boxHPipeline: GPUComputePipeline
  private readonly boxVPipeline: GPUComputePipeline
  private readonly radialBlurPipeline: GPUComputePipeline
  private readonly motionBlurPipeline: GPUComputePipeline
  private readonly lensBlurPipeline: GPUComputePipeline
  private readonly sharpenPipeline: GPUComputePipeline
  private readonly sharpenMorePipeline: GPUComputePipeline
  private readonly unsharpCombinePipeline: GPUComputePipeline
  private readonly intermediate0: GPUTexture
  private cachedKernelKey: string = ''
  private cachedKernelBuf: GPUBuffer | null = null
  private cachedKernelCount: number = 0

  private constructor(device: GPUDevice, width: number, height: number) {
    this.device = device

    const intermediateUsage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING

    this.intermediate0 = device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: intermediateUsage,
    })

    this.gaussianHPipeline = this.createPipeline(FILTER_GAUSSIAN_H_COMPUTE, 'cs_gaussian_h')
    this.gaussianVPipeline = this.createPipeline(FILTER_GAUSSIAN_V_COMPUTE, 'cs_gaussian_v')
    this.boxHPipeline = this.createPipeline(FILTER_BOX_H_COMPUTE, 'cs_box_h')
    this.boxVPipeline = this.createPipeline(FILTER_BOX_V_COMPUTE, 'cs_box_v')
    this.radialBlurPipeline = this.createPipeline(FILTER_RADIAL_BLUR_COMPUTE, 'cs_radial_blur')
    this.motionBlurPipeline = this.createPipeline(FILTER_MOTION_BLUR_COMPUTE, 'cs_motion_blur')
    this.lensBlurPipeline = this.createPipeline(FILTER_LENS_BLUR_COMPUTE, 'cs_lens_blur')
    this.sharpenPipeline     = this.createPipeline(FILTER_SHARPEN_COMPUTE, 'cs_sharpen')
    this.sharpenMorePipeline = this.createPipeline(FILTER_SHARPEN_MORE_COMPUTE, 'cs_sharpen_more')
    this.unsharpCombinePipeline = this.createPipeline(FILTER_UNSHARP_COMBINE_COMPUTE, 'cs_unsharp_combine')
  }

  static create(device: GPUDevice, width: number, height: number): FilterComputeEngine {
    return new FilterComputeEngine(device, width, height)
  }

  destroy(): void {
    this.intermediate0.destroy()
    this.cachedKernelBuf?.destroy()
    this.cachedKernelBuf = null
  }

  private createPipeline(wgsl: string, entryPoint: string): GPUComputePipeline {
    const module = this.device.createShaderModule({ code: wgsl })
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint },
    })
  }

  async gaussianBlur(
    pixels: Uint8Array,
    width: number,
    height: number,
    radius: number,
  ): Promise<Uint8Array> {
    const { device } = this
    const w = width
    const h = height

    const srcTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: srcTex },
      pixels as Uint8Array<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })

    const paramsData = new Uint32Array([radius, 0, 0, 0])
    const paramsBuf  = createUniformBuffer(device, 16)
    writeUniformBuffer(device, paramsBuf, paramsData)

    const encoder = device.createCommandEncoder()

    const hBindGroup = device.createBindGroup({
      layout: this.gaussianHPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: this.intermediate0.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
      ],
    })

    const hPass = encoder.beginComputePass()
    hPass.setPipeline(this.gaussianHPipeline)
    hPass.setBindGroup(0, hBindGroup)
    hPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    hPass.end()

    const vBindGroup = device.createBindGroup({
      layout: this.gaussianVPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.intermediate0.createView() },
        { binding: 1, resource: outTex.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
      ],
    })

    const vPass = encoder.beginComputePass()
    vPass.setPipeline(this.gaussianVPipeline)
    vPass.setBindGroup(0, vBindGroup)
    vPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    vPass.end()

    const alignedBpr = Math.ceil(w * 4 / 256) * 256
    const readbuf    = createReadbackBuffer(device, alignedBpr * h)
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
      { width: w, height: h },
    )

    device.queue.submit([encoder.finish()])

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
    readbuf.unmap()

    srcTex.destroy()
    outTex.destroy()
    paramsBuf.destroy()
    readbuf.destroy()

    return result
  }

  async boxBlur(
    pixels: Uint8Array,
    width: number,
    height: number,
    radius: number,
  ): Promise<Uint8Array> {
    const { device } = this
    const w = width
    const h = height

    const srcTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: srcTex },
      pixels as Uint8Array<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })

    const paramsData = new Uint32Array([radius, 0, 0, 0])
    const paramsBuf  = createUniformBuffer(device, 16)
    writeUniformBuffer(device, paramsBuf, paramsData)

    const encoder = device.createCommandEncoder()

    const hBindGroup = device.createBindGroup({
      layout: this.boxHPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: this.intermediate0.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
      ],
    })

    const hPass = encoder.beginComputePass()
    hPass.setPipeline(this.boxHPipeline)
    hPass.setBindGroup(0, hBindGroup)
    hPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    hPass.end()

    const vBindGroup = device.createBindGroup({
      layout: this.boxVPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.intermediate0.createView() },
        { binding: 1, resource: outTex.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
      ],
    })

    const vPass = encoder.beginComputePass()
    vPass.setPipeline(this.boxVPipeline)
    vPass.setBindGroup(0, vBindGroup)
    vPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    vPass.end()

    const alignedBpr = Math.ceil(w * 4 / 256) * 256
    const readbuf    = createReadbackBuffer(device, alignedBpr * h)
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
      { width: w, height: h },
    )

    device.queue.submit([encoder.finish()])

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
    readbuf.unmap()

    srcTex.destroy()
    outTex.destroy()
    paramsBuf.destroy()
    readbuf.destroy()

    return result
  }

  async radialBlur(
    pixels: Uint8Array,
    width: number,
    height: number,
    mode: number,
    amount: number,
    centerX: number,
    centerY: number,
    quality: number,
  ): Promise<Uint8Array> {
    const { device } = this
    const w = width
    const h = height

    const srcTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: srcTex },
      pixels as Uint8Array<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })

    const buf = new ArrayBuffer(32)
    const dv  = new DataView(buf)
    dv.setUint32(0,  mode,    true)
    dv.setUint32(4,  amount,  true)
    dv.setUint32(8,  quality, true)
    dv.setUint32(12, 0,       true)
    dv.setFloat32(16, centerX, true)
    dv.setFloat32(20, centerY, true)
    dv.setFloat32(24, 0,       true)
    dv.setFloat32(28, 0,       true)
    const paramsBuf = createUniformBuffer(device, 32)
    writeUniformBuffer(device, paramsBuf, buf)

    const encoder = device.createCommandEncoder()

    const bindGroup = device.createBindGroup({
      layout: this.radialBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: outTex.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.radialBlurPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    pass.end()

    const alignedBpr = Math.ceil(w * 4 / 256) * 256
    const readbuf    = createReadbackBuffer(device, alignedBpr * h)
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
      { width: w, height: h },
    )

    device.queue.submit([encoder.finish()])

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
    readbuf.unmap()

    srcTex.destroy()
    outTex.destroy()
    paramsBuf.destroy()
    readbuf.destroy()

    return result
  }

  async motionBlur(
    pixels: Uint8Array,
    width: number,
    height: number,
    angleDeg: number,
    distance: number,
  ): Promise<Uint8Array> {
    const { device } = this
    const w = width
    const h = height

    const srcTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: srcTex },
      pixels as Uint8Array<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })

    const buf = new ArrayBuffer(16)
    const dv  = new DataView(buf)
    dv.setFloat32(0,  angleDeg, true)
    dv.setUint32(4,   distance, true)
    dv.setUint32(8,   0,        true)
    dv.setUint32(12,  0,        true)
    const paramsBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, paramsBuf, buf)

    const encoder = device.createCommandEncoder()

    const bindGroup = device.createBindGroup({
      layout: this.motionBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: outTex.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.motionBlurPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    pass.end()

    const alignedBpr = Math.ceil(w * 4 / 256) * 256
    const readbuf    = createReadbackBuffer(device, alignedBpr * h)
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
      { width: w, height: h },
    )

    device.queue.submit([encoder.finish()])

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
    readbuf.unmap()

    srcTex.destroy()
    outTex.destroy()
    paramsBuf.destroy()
    readbuf.destroy()

    return result
  }

  private static buildKernelEntries(
    radius: number,
    bladeCount: number,
    bladeCurvature: number,
    rotation: number,
  ): Float32Array {
    const PI = Math.PI
    const bladeCurvF = bladeCurvature / 100.0
    const rotRad = rotation * PI / 180.0
    const bladeAngle = bladeCurvature < 100 ? (2.0 * PI / bladeCount) : 0.0
    const halfBlade = bladeAngle / 2.0
    const polyInradius = bladeCurvature < 100 ? Math.cos(PI / bladeCount) : 1.0

    const entries: Array<[number, number, number]> = []
    for (let ky = -radius; ky <= radius; ky++) {
      for (let kx = -radius; kx <= radius; kx++) {
        const nx = radius > 0 ? kx / radius : 0.0
        const ny = radius > 0 ? ky / radius : 0.0
        const r = Math.sqrt(nx * nx + ny * ny)
        if (r > 1.5) continue

        let w: number
        if (bladeCurvature >= 100) {
          w = r <= 1.0 ? 1.0 : 0.0
        } else {
          const theta = Math.atan2(ny, nx) + rotRad
          const sector = ((theta + 20.0 * PI) % bladeAngle + bladeAngle) % bladeAngle
          const polyR = polyInradius / Math.cos(sector - halfBlade)
          const effectiveR = polyR * (1.0 - bladeCurvF) + 1.0 * bladeCurvF
          w = r <= effectiveR ? 1.0 : 0.0
        }
        if (w > 0) entries.push([kx, ky, w])
      }
    }

    const sum = entries.reduce((acc, e) => acc + e[2], 0)
    const inv = sum > 0 ? 1.0 / sum : 1.0

    const result = new Float32Array(entries.length * 4)
    for (let i = 0; i < entries.length; i++) {
      result[i * 4 + 0] = entries[i][0]
      result[i * 4 + 1] = entries[i][1]
      result[i * 4 + 2] = entries[i][2] * inv
      result[i * 4 + 3] = 0
    }
    return result
  }

  async lensBlur(
    pixels: Uint8Array,
    width: number,
    height: number,
    radius: number,
    bladeCount: number,
    bladeCurvature: number,
    rotation: number,
  ): Promise<Uint8Array> {
    const { device } = this
    const w = width
    const h = height

    const kernelKey = `${radius}|${bladeCount}|${bladeCurvature}|${rotation}`
    if (this.cachedKernelKey !== kernelKey) {
      this.cachedKernelBuf?.destroy()
      const entries = FilterComputeEngine.buildKernelEntries(radius, bladeCount, bladeCurvature, rotation)
      const buf = device.createBuffer({
        size: Math.max(entries.byteLength, 16),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(buf, 0, entries)
      this.cachedKernelBuf = buf
      this.cachedKernelKey = kernelKey
      this.cachedKernelCount = entries.length / 4
    }
    const maskBuf = this.cachedKernelBuf!
    const kernelCount = this.cachedKernelCount

    const srcTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: srcTex },
      pixels as Uint8Array<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })

    const paramsData = new Uint32Array([kernelCount, 0, 0, 0])
    const paramsBuf  = createUniformBuffer(device, 16)
    writeUniformBuffer(device, paramsBuf, paramsData)

    const encoder = device.createCommandEncoder()

    const bindGroup = device.createBindGroup({
      layout: this.lensBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: outTex.createView() },
        { binding: 2, resource: { buffer: paramsBuf } },
        { binding: 3, resource: { buffer: maskBuf } },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.lensBlurPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16))
    pass.end()

    const alignedBpr = Math.ceil(w * 4 / 256) * 256
    const readbuf    = createReadbackBuffer(device, alignedBpr * h)
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
      { width: w, height: h },
    )

    device.queue.submit([encoder.finish()])

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
    readbuf.unmap()

    srcTex.destroy()
    outTex.destroy()
    paramsBuf.destroy()
    readbuf.destroy()

    return result
  }

  async sharpen(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    const { device } = this
    const w = width, h = height

    const srcTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: srcTex },
      pixels as Uint8Array<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })

    const encoder = device.createCommandEncoder()
    const bindGroup = device.createBindGroup({
      layout: this.sharpenPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: outTex.createView() },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.sharpenPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    pass.end()

    const alignedBpr = Math.ceil(w * 4 / 256) * 256
    const readbuf    = createReadbackBuffer(device, alignedBpr * h)
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
      { width: w, height: h },
    )

    device.queue.submit([encoder.finish()])

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
    readbuf.unmap()

    srcTex.destroy()
    outTex.destroy()
    readbuf.destroy()

    return result
  }

  async sharpenMore(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    const { device } = this
    const w = width, h = height

    const srcTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: srcTex },
      pixels as Uint8Array<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })

    const encoder = device.createCommandEncoder()
    const bindGroup = device.createBindGroup({
      layout: this.sharpenMorePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: outTex.createView() },
      ],
    })

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.sharpenMorePipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    pass.end()

    const alignedBpr = Math.ceil(w * 4 / 256) * 256
    const readbuf    = createReadbackBuffer(device, alignedBpr * h)
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
      { width: w, height: h },
    )

    device.queue.submit([encoder.finish()])

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
    readbuf.unmap()

    srcTex.destroy()
    outTex.destroy()
    readbuf.destroy()

    return result
  }

  async unsharpMask(
    pixels: Uint8Array,
    width: number,
    height: number,
    amount: number,
    radius: number,
    threshold: number,
  ): Promise<Uint8Array> {
    const { device } = this
    const w = width, h = height

    const srcTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: srcTex },
      pixels as Uint8Array<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )

    // blurredTex: rgba8unorm to match the Gaussian V shader's declared output format
    const blurredTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })

    // Gaussian params (radius)
    const gaussParamsData = new Uint32Array([radius, 0, 0, 0])
    const gaussParamsBuf  = createUniformBuffer(device, 16)
    writeUniformBuffer(device, gaussParamsBuf, gaussParamsData)

    // Unsharp combine params (amount, threshold)
    const combineParamsData = new Uint32Array([amount, threshold, 0, 0])
    const combineParamsBuf  = createUniformBuffer(device, 16)
    writeUniformBuffer(device, combineParamsBuf, combineParamsData)

    const encoder = device.createCommandEncoder()

    // Pass 1: Gaussian H — srcTex (rgba8unorm) → intermediate0 (rgba16float)
    const hBindGroup = device.createBindGroup({
      layout: this.gaussianHPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: this.intermediate0.createView() },
        { binding: 2, resource: { buffer: gaussParamsBuf } },
      ],
    })
    const hPass = encoder.beginComputePass()
    hPass.setPipeline(this.gaussianHPipeline)
    hPass.setBindGroup(0, hBindGroup)
    hPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    hPass.end()

    // Pass 2: Gaussian V — intermediate0 (rgba16float) → blurredTex (rgba8unorm)
    const vBindGroup = device.createBindGroup({
      layout: this.gaussianVPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.intermediate0.createView() },
        { binding: 1, resource: blurredTex.createView() },
        { binding: 2, resource: { buffer: gaussParamsBuf } },
      ],
    })
    const vPass = encoder.beginComputePass()
    vPass.setPipeline(this.gaussianVPipeline)
    vPass.setBindGroup(0, vBindGroup)
    vPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    vPass.end()

    // Pass 3: Combine — srcTex + blurredTex → outTex
    const combineBindGroup = device.createBindGroup({
      layout: this.unsharpCombinePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: blurredTex.createView() },
        { binding: 2, resource: outTex.createView() },
        { binding: 3, resource: { buffer: combineParamsBuf } },
      ],
    })
    const combinePass = encoder.beginComputePass()
    combinePass.setPipeline(this.unsharpCombinePipeline)
    combinePass.setBindGroup(0, combineBindGroup)
    combinePass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    combinePass.end()

    const alignedBpr = Math.ceil(w * 4 / 256) * 256
    const readbuf    = createReadbackBuffer(device, alignedBpr * h)
    encoder.copyTextureToBuffer(
      { texture: outTex },
      { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
      { width: w, height: h },
    )

    device.queue.submit([encoder.finish()])

    await readbuf.mapAsync(GPUMapMode.READ)
    const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
    readbuf.unmap()

    srcTex.destroy()
    blurredTex.destroy()
    outTex.destroy()
    gaussParamsBuf.destroy()
    combineParamsBuf.destroy()
    readbuf.destroy()

    return result
  }
}

function unpackRows(src: Uint8Array, w: number, h: number, alignedBpr: number): Uint8Array {
  const packedBpr = w * 4
  if (alignedBpr === packedBpr) return src.slice()
  const out = new Uint8Array(packedBpr * h)
  for (let row = 0; row < h; row++) {
    out.set(src.subarray(row * alignedBpr, row * alignedBpr + packedBpr), row * packedBpr)
  }
  return out
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _engine: FilterComputeEngine | null = null

export function initFilterCompute(device: GPUDevice, width: number, height: number): void {
  _engine?.destroy()
  _engine = FilterComputeEngine.create(device, width, height)
}

export async function gaussianBlur(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Promise<Uint8Array> {
  return _engine!.gaussianBlur(pixels, width, height, radius)
}

export async function boxBlur(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Promise<Uint8Array> {
  return _engine!.boxBlur(pixels, width, height, radius)
}

export async function radialBlur(
  pixels: Uint8Array,
  width: number,
  height: number,
  mode: number,
  amount: number,
  centerX: number,
  centerY: number,
  quality: number,
): Promise<Uint8Array> {
  return _engine!.radialBlur(pixels, width, height, mode, amount, centerX, centerY, quality)
}

export async function motionBlur(
  pixels: Uint8Array,
  width: number,
  height: number,
  angleDeg: number,
  distance: number,
): Promise<Uint8Array> {
  return _engine!.motionBlur(pixels, width, height, angleDeg, distance)
}

export async function lensBlur(
  pixels: Uint8Array,
  width: number,
  height: number,
  radius: number,
  bladeCount: number,
  bladeCurvature: number,
  rotation: number,
): Promise<Uint8Array> {
  return _engine!.lensBlur(pixels, width, height, radius, bladeCount, bladeCurvature, rotation)
}

export async function sharpen(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  return _engine!.sharpen(pixels, width, height)
}

export async function sharpenMore(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  return _engine!.sharpenMore(pixels, width, height)
}

export async function unsharpMask(
  pixels: Uint8Array,
  width: number,
  height: number,
  amount: number,
  radius: number,
  threshold: number,
): Promise<Uint8Array> {
  return _engine!.unsharpMask(pixels, width, height, amount, radius, threshold)
}
