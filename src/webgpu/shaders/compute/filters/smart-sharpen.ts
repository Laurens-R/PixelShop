import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../../utils'

export const FILTER_SMART_SHARPEN_GAUSS_COMBINE_COMPUTE = /* wgsl */ `
struct SmartSharpenGaussParams {
  amount : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex     : texture_2d<f32>;
@group(0) @binding(1) var blurredTex : texture_2d<f32>;
@group(0) @binding(2) var dstTex     : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : SmartSharpenGaussParams;

@compute @workgroup_size(8, 8)
fn cs_smart_sharpen_gauss(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let orig    = textureLoad(srcTex,     vec2i(id.xy), 0);
  let blurred = textureLoad(blurredTex, vec2i(id.xy), 0);
  let scale   = f32(params.amount) / 100.0;

  let diff = orig.rgb - blurred.rgb;
  let outRGB = clamp(orig.rgb + scale * diff, vec3f(0.0), vec3f(1.0));

  textureStore(dstTex, vec2i(id.xy), vec4f(outRGB, orig.a));
}
`

export const FILTER_SMART_SHARPEN_LENS_COMPUTE = /* wgsl */ `
struct SmartSharpenLensParams {
  amount : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : SmartSharpenLensParams;

@compute @workgroup_size(8, 8)
fn cs_smart_sharpen_lens(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let s = (f32(params.amount) / 100.0) * 0.5;

  // kernel: [-s,-s,-s, -s, 1+8*s, -s, -s,-s,-s]
  var colorSum = vec3f(0.0);
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let samp = textureLoad(srcTex, vec2i(sx, sy), 0).rgb;
      let isCenter = select(0.0, 1.0, kx == 0 && ky == 0);
      let k = isCenter * (1.0 + 8.0 * s) + (1.0 - isCenter) * (-s);
      colorSum += samp * k;
    }
  }

  let orig = textureLoad(srcTex, vec2i(id.xy), 0);
  textureStore(dstTex, vec2i(id.xy), vec4f(clamp(colorSum, vec3f(0.0), vec3f(1.0)), orig.a));
}
`

export const FILTER_SMART_SHARPEN_BLEND_COMPUTE = /* wgsl */ `
struct SmartSharpenBlendParams {
  reduceNoise : u32,  // 0–100 (%)
  _pad0       : u32,
  _pad1       : u32,
  _pad2       : u32,
}

@group(0) @binding(0) var sharpenedTex : texture_2d<f32>;
@group(0) @binding(1) var smoothedTex  : texture_2d<f32>;
@group(0) @binding(2) var dstTex       : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : SmartSharpenBlendParams;

@compute @workgroup_size(8, 8)
fn cs_smart_sharpen_blend(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(sharpenedTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let sharpened = textureLoad(sharpenedTex, vec2i(id.xy), 0);
  let smoothed  = textureLoad(smoothedTex,  vec2i(id.xy), 0);

  let blendFactor = (f32(params.reduceNoise) / 100.0) * 0.5;
  let outRGB = clamp(
    sharpened.rgb * (1.0 - blendFactor) + smoothed.rgb * blendFactor,
    vec3f(0.0), vec3f(1.0)
  );

  textureStore(dstTex, vec2i(id.xy), vec4f(outRGB, sharpened.a));
}
`

export async function runSmartSharpen(
  device: GPUDevice,
  gaussianH: GPUComputePipeline,
  gaussianV: GPUComputePipeline,
  boxH: GPUComputePipeline,
  boxV: GPUComputePipeline,
  smartSharpenGaussCombine: GPUComputePipeline,
  smartSharpenLens: GPUComputePipeline,
  smartSharpenBlend: GPUComputePipeline,
  intermediate0: GPUTexture,
  pixels: Uint8Array,
  w: number,
  h: number,
  amount: number,
  radius: number,
  reduceNoise: number,
  remove: number,
): Promise<Uint8Array> {
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

  const sharpenedTexUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC |
    (reduceNoise > 0 ? GPUTextureUsage.TEXTURE_BINDING : 0)
  const sharpenedTex = device.createTexture({
    size: { width: w, height: h },
    format: 'rgba8unorm',
    usage: sharpenedTexUsage,
  })

  const encoder = device.createCommandEncoder()

  let _blurredTex: GPUTexture | null = null
  let _gaussParamsBuf: GPUBuffer | null = null
  let _combineParamsBuf: GPUBuffer | null = null
  let _lensParamsBuf: GPUBuffer | null = null

  if (remove === 0) {
    const gaussParamsBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, gaussParamsBuf, new Uint32Array([radius, 0, 0, 0]))
    _gaussParamsBuf = gaussParamsBuf

    const blurredTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })
    _blurredTex = blurredTex

    const hPass = encoder.beginComputePass()
    hPass.setPipeline(gaussianH)
    hPass.setBindGroup(0, device.createBindGroup({
      layout: gaussianH.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: intermediate0.createView() },
        { binding: 2, resource: { buffer: gaussParamsBuf } },
      ],
    }))
    hPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    hPass.end()

    const vPass = encoder.beginComputePass()
    vPass.setPipeline(gaussianV)
    vPass.setBindGroup(0, device.createBindGroup({
      layout: gaussianV.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: intermediate0.createView() },
        { binding: 1, resource: blurredTex.createView() },
        { binding: 2, resource: { buffer: gaussParamsBuf } },
      ],
    }))
    vPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    vPass.end()

    const combineParamsBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, combineParamsBuf, new Uint32Array([amount, 0, 0, 0]))
    _combineParamsBuf = combineParamsBuf

    const combinePass = encoder.beginComputePass()
    combinePass.setPipeline(smartSharpenGaussCombine)
    combinePass.setBindGroup(0, device.createBindGroup({
      layout: smartSharpenGaussCombine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: blurredTex.createView() },
        { binding: 2, resource: sharpenedTex.createView() },
        { binding: 3, resource: { buffer: combineParamsBuf } },
      ],
    }))
    combinePass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    combinePass.end()
  } else {
    const lensParamsBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, lensParamsBuf, new Uint32Array([amount, 0, 0, 0]))
    _lensParamsBuf = lensParamsBuf

    const lensPass = encoder.beginComputePass()
    lensPass.setPipeline(smartSharpenLens)
    lensPass.setBindGroup(0, device.createBindGroup({
      layout: smartSharpenLens.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: sharpenedTex.createView() },
        { binding: 2, resource: { buffer: lensParamsBuf } },
      ],
    }))
    lensPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    lensPass.end()
  }

  let finalTex: GPUTexture
  let _outTex: GPUTexture | null = null
  let _smoothedTex: GPUTexture | null = null
  let _noiseParamsBuf: GPUBuffer | null = null
  let _boxParamsBuf: GPUBuffer | null = null

  if (reduceNoise > 0) {
    const boxParamsBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, boxParamsBuf, new Uint32Array([1, 0, 0, 0]))
    _boxParamsBuf = boxParamsBuf

    const smoothedTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })
    _smoothedTex = smoothedTex

    const bHPass = encoder.beginComputePass()
    bHPass.setPipeline(boxH)
    bHPass.setBindGroup(0, device.createBindGroup({
      layout: boxH.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sharpenedTex.createView() },
        { binding: 1, resource: intermediate0.createView() },
        { binding: 2, resource: { buffer: boxParamsBuf } },
      ],
    }))
    bHPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    bHPass.end()

    const bVPass = encoder.beginComputePass()
    bVPass.setPipeline(boxV)
    bVPass.setBindGroup(0, device.createBindGroup({
      layout: boxV.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: intermediate0.createView() },
        { binding: 1, resource: smoothedTex.createView() },
        { binding: 2, resource: { buffer: boxParamsBuf } },
      ],
    }))
    bVPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    bVPass.end()

    const noiseParamsBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, noiseParamsBuf, new Uint32Array([reduceNoise, 0, 0, 0]))
    _noiseParamsBuf = noiseParamsBuf

    const outTex = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })
    _outTex = outTex

    const blendPass = encoder.beginComputePass()
    blendPass.setPipeline(smartSharpenBlend)
    blendPass.setBindGroup(0, device.createBindGroup({
      layout: smartSharpenBlend.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sharpenedTex.createView() },
        { binding: 1, resource: smoothedTex.createView() },
        { binding: 2, resource: outTex.createView() },
        { binding: 3, resource: { buffer: noiseParamsBuf } },
      ],
    }))
    blendPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    blendPass.end()

    finalTex = outTex
  } else {
    finalTex = sharpenedTex
  }

  const alignedBpr = Math.ceil(w * 4 / 256) * 256
  const readbuf    = createReadbackBuffer(device, alignedBpr * h)
  encoder.copyTextureToBuffer(
    { texture: finalTex },
    { buffer: readbuf, bytesPerRow: alignedBpr, rowsPerImage: h },
    { width: w, height: h },
  )

  device.queue.submit([encoder.finish()])

  await readbuf.mapAsync(GPUMapMode.READ)
  const result = unpackRows(new Uint8Array(readbuf.getMappedRange()), w, h, alignedBpr)
  readbuf.unmap()

  srcTex.destroy()
  sharpenedTex.destroy()
  _blurredTex?.destroy()
  _gaussParamsBuf?.destroy()
  _combineParamsBuf?.destroy()
  _lensParamsBuf?.destroy()
  _smoothedTex?.destroy()
  _outTex?.destroy()
  _noiseParamsBuf?.destroy()
  _boxParamsBuf?.destroy()
  readbuf.destroy()

  return result
}
