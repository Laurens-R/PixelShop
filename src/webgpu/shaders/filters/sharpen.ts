import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../utils'

export const FILTER_SHARPEN_COMPUTE = /* wgsl */ `
@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;

const kernel = array<f32, 9>(
   0.0, -1.0,  0.0,
  -1.0,  5.0, -1.0,
   0.0, -1.0,  0.0,
);

@compute @workgroup_size(8, 8)
fn cs_sharpen(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  var colorSum = vec4f(0.0);
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let k  = kernel[(ky + 1) * 3 + (kx + 1)];
      colorSum += textureLoad(srcTex, vec2i(sx, sy), 0) * k;
    }
  }
  // preserve original alpha
  let orig = textureLoad(srcTex, vec2i(id.xy), 0);
  textureStore(dstTex, vec2i(id.xy), vec4f(clamp(colorSum.rgb, vec3f(0.0), vec3f(1.0)), orig.a));
}
`

export const FILTER_SHARPEN_MORE_COMPUTE = /* wgsl */ `
@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;

const kernel = array<f32, 9>(
  -1.0, -1.0, -1.0,
  -1.0,  9.0, -1.0,
  -1.0, -1.0, -1.0,
);

@compute @workgroup_size(8, 8)
fn cs_sharpen_more(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  var colorSum = vec4f(0.0);
  for (var ky = -1; ky <= 1; ky++) {
    for (var kx = -1; kx <= 1; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let k  = kernel[(ky + 1) * 3 + (kx + 1)];
      colorSum += textureLoad(srcTex, vec2i(sx, sy), 0) * k;
    }
  }
  let orig = textureLoad(srcTex, vec2i(id.xy), 0);
  textureStore(dstTex, vec2i(id.xy), vec4f(clamp(colorSum.rgb, vec3f(0.0), vec3f(1.0)), orig.a));
}
`

export const FILTER_UNSHARP_COMBINE_COMPUTE = /* wgsl */ `
struct UnsharpParams {
  amount    : u32,   // 1–500 (%)
  threshold : u32,   // 0–255 (levels)
  _pad0     : u32,
  _pad1     : u32,
}

@group(0) @binding(0) var origTex    : texture_2d<f32>;
@group(0) @binding(1) var blurredTex : texture_2d<f32>;
@group(0) @binding(2) var dstTex     : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : UnsharpParams;

@compute @workgroup_size(8, 8)
fn cs_unsharp_combine(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(origTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let orig    = textureLoad(origTex,    vec2i(id.xy), 0);
  let blurred = textureLoad(blurredTex, vec2i(id.xy), 0);

  let scale = f32(params.amount) / 100.0;
  let thr   = f32(params.threshold) / 255.0;

  let dR = orig.r - blurred.r;
  let dG = orig.g - blurred.g;
  let dB = orig.b - blurred.b;

  let lumaDiff = abs(0.299 * dR + 0.587 * dG + 0.114 * dB);

  var outColor: vec4f;
  if (lumaDiff > thr) {
    outColor = vec4f(
      clamp(orig.r + scale * dR, 0.0, 1.0),
      clamp(orig.g + scale * dG, 0.0, 1.0),
      clamp(orig.b + scale * dB, 0.0, 1.0),
      orig.a,
    );
  } else {
    outColor = vec4f(orig.rgb, orig.a);
  }

  textureStore(dstTex, vec2i(id.xy), outColor);
}
`

export async function runSharpen(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  pixels: Uint8Array,
  w: number,
  h: number,
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

  const outTex = device.createTexture({
    size: { width: w, height: h },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })

  const encoder = device.createCommandEncoder()
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: outTex.createView() },
    ],
  })

  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
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

export async function runSharpenMore(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  pixels: Uint8Array,
  w: number,
  h: number,
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

  const outTex = device.createTexture({
    size: { width: w, height: h },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })

  const encoder = device.createCommandEncoder()
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: outTex.createView() },
    ],
  })

  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
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

export async function runUnsharpMask(
  device: GPUDevice,
  gaussianH: GPUComputePipeline,
  gaussianV: GPUComputePipeline,
  unsharpCombine: GPUComputePipeline,
  intermediate0: GPUTexture,
  pixels: Uint8Array,
  w: number,
  h: number,
  amount: number,
  radius: number,
  threshold: number,
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
    layout: gaussianH.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: intermediate0.createView() },
      { binding: 2, resource: { buffer: gaussParamsBuf } },
    ],
  })
  const hPass = encoder.beginComputePass()
  hPass.setPipeline(gaussianH)
  hPass.setBindGroup(0, hBindGroup)
  hPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  hPass.end()

  // Pass 2: Gaussian V — intermediate0 (rgba16float) → blurredTex (rgba8unorm)
  const vBindGroup = device.createBindGroup({
    layout: gaussianV.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: intermediate0.createView() },
      { binding: 1, resource: blurredTex.createView() },
      { binding: 2, resource: { buffer: gaussParamsBuf } },
    ],
  })
  const vPass = encoder.beginComputePass()
  vPass.setPipeline(gaussianV)
  vPass.setBindGroup(0, vBindGroup)
  vPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  vPass.end()

  // Pass 3: Combine — srcTex + blurredTex → outTex
  const combineBindGroup = device.createBindGroup({
    layout: unsharpCombine.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: blurredTex.createView() },
      { binding: 2, resource: outTex.createView() },
      { binding: 3, resource: { buffer: combineParamsBuf } },
    ],
  })
  const combinePass = encoder.beginComputePass()
  combinePass.setPipeline(unsharpCombine)
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
