import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../../utils'

export const FILTER_BILATERAL_COMPUTE = /* wgsl */ `
struct BilateralParams {
  radius       : u32,
  _pad0        : u32,
  sigmaSpatial : f32,
  sigmaColor   : f32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : BilateralParams;

@compute @workgroup_size(8, 8)
fn cs_bilateral(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let center = textureLoad(srcTex, vec2i(id.xy), 0);
  let r      = i32(params.radius);

  let inv2SigmaS2 = 1.0 / (2.0 * params.sigmaSpatial * params.sigmaSpatial);
  let inv2SigmaC2 = 1.0 / (2.0 * params.sigmaColor   * params.sigmaColor);

  var weightSum = 0.0;
  var colorSum  = vec3f(0.0);

  for (var ky = -r; ky <= r; ky++) {
    for (var kx = -r; kx <= r; kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      let neighbor = textureLoad(srcTex, vec2i(sx, sy), 0);

      let spatialDist2 = f32(kx * kx + ky * ky);
      let colorDiff    = neighbor.rgb - center.rgb;
      let colorDist2   = dot(colorDiff, colorDiff);

      let w = exp(-spatialDist2 * inv2SigmaS2) * exp(-colorDist2 * inv2SigmaC2);

      colorSum  += neighbor.rgb * w;
      weightSum += w;
    }
  }

  let result = colorSum * (1.0 / weightSum);
  textureStore(dstTex, vec2i(id.xy), vec4f(result, center.a));
}
` as const

export async function runBilateral(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  pixels: Uint8Array,
  w: number,
  h: number,
  radius: number,
  sigmaSpatial: number,
  sigmaColor: number,
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

  const buf = new ArrayBuffer(16)
  const dv  = new DataView(buf)
  dv.setUint32(0,   radius,       true)
  dv.setUint32(4,   0,            true)
  dv.setFloat32(8,  sigmaSpatial, true)
  dv.setFloat32(12, sigmaColor,   true)
  const paramsBuf = createUniformBuffer(device, 16)
  writeUniformBuffer(device, paramsBuf, buf)

  const encoder = device.createCommandEncoder()
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: outTex.createView() },
      { binding: 2, resource: { buffer: paramsBuf } },
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
  paramsBuf.destroy()
  readbuf.destroy()

  return result
}
