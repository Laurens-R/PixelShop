import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../utils'

export const FILTER_LENS_BLUR_COMPUTE = /* wgsl */ `
struct LensBlurParams {
  kernelCount : u32,
  _pad0       : u32,
  _pad1       : u32,
  _pad2       : u32,
}

struct KernelEntry {
  kx     : f32,
  ky     : f32,
  weight : f32,
  _pad   : f32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : LensBlurParams;
@group(0) @binding(3) var<storage, read> kernelEntries : array<KernelEntry>;

fn sampleBilinear(coord: vec2f, dims: vec2u) -> vec4f {
  let clamped = clamp(coord, vec2f(0.0), vec2f(f32(dims.x) - 1.0, f32(dims.y) - 1.0));
  let x0 = i32(clamped.x); let y0 = i32(clamped.y);
  let x1 = min(x0 + 1, i32(dims.x) - 1);
  let y1 = min(y0 + 1, i32(dims.y) - 1);
  let fx = clamped.x - f32(x0); let fy = clamped.y - f32(y0);
  let p00 = textureLoad(srcTex, vec2i(x0, y0), 0);
  let p10 = textureLoad(srcTex, vec2i(x1, y0), 0);
  let p01 = textureLoad(srcTex, vec2i(x0, y1), 0);
  let p11 = textureLoad(srcTex, vec2i(x1, y1), 0);
  return mix(mix(p00, p10, fx), mix(p01, p11, fx), fy);
}

@compute @workgroup_size(16, 16)
fn cs_lens_blur(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let px = f32(id.x);
  let py = f32(id.y);
  var colorSum = vec4f(0.0);

  for (var i = 0u; i < params.kernelCount; i++) {
    let e = kernelEntries[i];
    colorSum += sampleBilinear(vec2f(px + e.kx, py + e.ky), dims) * e.weight;
  }

  textureStore(dstTex, vec2i(id.xy), colorSum);
}
` as const

export function buildKernelEntries(
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

export async function runLensBlur(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  pixels: Uint8Array,
  w: number,
  h: number,
  kernelBuf: GPUBuffer,
  kernelCount: number,
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

  const paramsData = new Uint32Array([kernelCount, 0, 0, 0])
  const paramsBuf  = createUniformBuffer(device, 16)
  writeUniformBuffer(device, paramsBuf, paramsData)

  const encoder = device.createCommandEncoder()

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: outTex.createView() },
      { binding: 2, resource: { buffer: paramsBuf } },
      { binding: 3, resource: { buffer: kernelBuf } },
    ],
  })

  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
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
