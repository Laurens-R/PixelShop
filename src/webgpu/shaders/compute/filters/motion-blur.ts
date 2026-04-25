import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../../utils'

export const FILTER_MOTION_BLUR_COMPUTE = /* wgsl */ `
struct MotionBlurParams {
  angleDeg : f32,
  distance : u32,
  _pad0    : u32,
  _pad1    : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : MotionBlurParams;

fn sampleBilinear(coord: vec2f, dims: vec2u) -> vec4f {
  let clamped = clamp(coord, vec2f(0.0), vec2f(f32(dims.x) - 1.0, f32(dims.y) - 1.0));
  let x0 = i32(clamped.x);
  let y0 = i32(clamped.y);
  let x1 = min(x0 + 1, i32(dims.x) - 1);
  let y1 = min(y0 + 1, i32(dims.y) - 1);
  let fx = clamped.x - f32(x0);
  let fy = clamped.y - f32(y0);
  let p00 = textureLoad(srcTex, vec2i(x0, y0), 0);
  let p10 = textureLoad(srcTex, vec2i(x1, y0), 0);
  let p01 = textureLoad(srcTex, vec2i(x0, y1), 0);
  let p11 = textureLoad(srcTex, vec2i(x1, y1), 0);
  return mix(mix(p00, p10, fx), mix(p01, p11, fx), fy);
}

@compute @workgroup_size(8, 8)
fn cs_motion_blur(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let px    = f32(id.x);
  let py    = f32(id.y);
  let angle = params.angleDeg * 3.14159265358979323846 / 180.0;
  let stepX = cos(angle);
  let stepY = sin(angle);
  let dist  = params.distance;

  var colorSum = vec4f(0.0);
  for (var i = 0u; i < dist; i++) {
    let offset = f32(i) - f32(dist - 1u) * 0.5;
    colorSum += sampleBilinear(vec2f(px + stepX * offset, py + stepY * offset), dims);
  }

  textureStore(dstTex, vec2i(id.xy), colorSum * (1.0 / f32(dist)));
}
` as const

export async function runMotionBlur(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  pixels: Uint8Array,
  w: number,
  h: number,
  angleDeg: number,
  distance: number,
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
  dv.setFloat32(0,  angleDeg, true)
  dv.setUint32(4,   distance, true)
  dv.setUint32(8,   0,        true)
  dv.setUint32(12,  0,        true)
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
