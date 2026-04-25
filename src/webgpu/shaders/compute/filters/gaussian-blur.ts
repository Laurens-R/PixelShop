import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../../utils'

export const FILTER_GAUSSIAN_H_COMPUTE = /* wgsl */ `
struct GaussianBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex     : texture_2d<f32>;
@group(0) @binding(1) var dstTex     : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params    : GaussianBlurParams;

@compute @workgroup_size(8, 8)
fn cs_gaussian_h(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord    = vec2i(id.xy);
  let sigma    = max(f32(params.radius), 1.0) / 3.0;
  let inv2sig2 = 1.0 / (2.0 * sigma * sigma);
  let maxR     = i32(params.radius);

  var weightSum = 0.0;
  var colorSum  = vec4f(0.0);

  for (var x = -maxR; x <= maxR; x++) {
    let w  = exp(-f32(x * x) * inv2sig2);
    let sx = clamp(coord.x + x, 0, i32(dims.x) - 1);
    colorSum  += textureLoad(srcTex, vec2i(sx, coord.y), 0) * w;
    weightSum += w;
  }

  textureStore(dstTex, coord, colorSum * (1.0 / weightSum));
}
` as const

export const FILTER_GAUSSIAN_V_COMPUTE = /* wgsl */ `
struct GaussianBlurParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex     : texture_2d<f32>;
@group(0) @binding(1) var dstTex     : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params    : GaussianBlurParams;

@compute @workgroup_size(8, 8)
fn cs_gaussian_v(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let coord    = vec2i(id.xy);
  let sigma    = max(f32(params.radius), 1.0) / 3.0;
  let inv2sig2 = 1.0 / (2.0 * sigma * sigma);
  let maxR     = i32(params.radius);

  var weightSum = 0.0;
  var colorSum  = vec4f(0.0);

  for (var y = -maxR; y <= maxR; y++) {
    let w  = exp(-f32(y * y) * inv2sig2);
    let sy = clamp(coord.y + y, 0, i32(dims.y) - 1);
    colorSum  += textureLoad(srcTex, vec2i(coord.x, sy), 0) * w;
    weightSum += w;
  }

  let blurred = colorSum * (1.0 / weightSum);

  textureStore(dstTex, coord, blurred);
}
` as const

export async function runGaussianBlur(
  device: GPUDevice,
  hPipeline: GPUComputePipeline,
  vPipeline: GPUComputePipeline,
  intermediate0: GPUTexture,
  pixels: Uint8Array,
  w: number,
  h: number,
  radius: number,
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

  const paramsData = new Uint32Array([radius, 0, 0, 0])
  const paramsBuf  = createUniformBuffer(device, 16)
  writeUniformBuffer(device, paramsBuf, paramsData)

  const encoder = device.createCommandEncoder()

  const hBindGroup = device.createBindGroup({
    layout: hPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: intermediate0.createView() },
      { binding: 2, resource: { buffer: paramsBuf } },
    ],
  })

  const hPass = encoder.beginComputePass()
  hPass.setPipeline(hPipeline)
  hPass.setBindGroup(0, hBindGroup)
  hPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  hPass.end()

  const vBindGroup = device.createBindGroup({
    layout: vPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: intermediate0.createView() },
      { binding: 1, resource: outTex.createView() },
      { binding: 2, resource: { buffer: paramsBuf } },
    ],
  })

  const vPass = encoder.beginComputePass()
  vPass.setPipeline(vPipeline)
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
