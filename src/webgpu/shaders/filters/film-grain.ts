import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../utils'

export const FILTER_FILM_GRAIN_NOISE_COMPUTE = /* wgsl */ `
struct FilmGrainNoiseParams {
  seed  : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
}

@group(0) @binding(0) var noiseTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params : FilmGrainNoiseParams;

fn lcg_next(s: u32) -> u32 {
  return 1664525u * s + 1013904223u;
}

fn pcg_hash(v: u32) -> u32 {
  let word = v * 747796405u + 2891336453u;
  return ((word >> ((word >> 28u) + 4u)) ^ word) * 277803737u;
}

@compute @workgroup_size(8, 8)
fn cs_film_grain_noise(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(noiseTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let idx   = id.y * dims.x + id.x;
  var state = pcg_hash(params.seed ^ pcg_hash(idx));

  var sum = 0.0;
  for (var k = 0u; k < 4u; k++) {
    state = lcg_next(state);
    sum += f32(state >> 16u) / 32767.5;
  }
  let noise    = sum / 4.0 - 1.0;                   // [-1, 1]
  let encoded  = clamp((noise + 1.0) * 0.5, 0.0, 1.0);  // [0, 1]

  textureStore(noiseTex, vec2i(id.xy), vec4f(encoded, encoded, encoded, encoded));
}
`

export const FILTER_FILM_GRAIN_COMBINE_COMPUTE = /* wgsl */ `
struct FilmGrainCombineParams {
  intensity : u32,  // 1–200 (%)
  roughness : u32,  // 0–100
  _pad0     : u32,
  _pad1     : u32,
}

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var noiseTex : texture_2d<f32>;
@group(0) @binding(2) var dstTex   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : FilmGrainCombineParams;

@compute @workgroup_size(8, 8)
fn cs_film_grain_combine(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let orig       = textureLoad(srcTex,   vec2i(id.xy), 0);
  let noiseTexel = textureLoad(noiseTex, vec2i(id.xy), 0);

  let noiseVal   = noiseTexel.r * 2.0 - 1.0;    // decode [0,1] → [-1,1]
  let intensityF = f32(params.intensity) / 100.0;
  let roughnessF = f32(params.roughness) / 100.0;

  let luma   = 0.299 * orig.r + 0.587 * orig.g + 0.114 * orig.b;
  let weight = (1.0 - roughnessF) * (1.0 - luma) + roughnessF * 1.0;

  let grainVal = noiseVal * (127.0 / 255.0) * weight * intensityF;

  let outRGB = clamp(orig.rgb + grainVal, vec3f(0.0), vec3f(1.0));
  textureStore(dstTex, vec2i(id.xy), vec4f(outRGB, orig.a));
}
`

export async function runFilmGrain(
  device: GPUDevice,
  noisePipeline: GPUComputePipeline,
  combinePipeline: GPUComputePipeline,
  boxH: GPUComputePipeline,
  boxV: GPUComputePipeline,
  intermediate0: GPUTexture,
  pixels: Uint8Array,
  w: number,
  h: number,
  grainSize: number,
  intensity: number,
  roughness: number,
  seed: number,
): Promise<Uint8Array> {
  const blurRadius = grainSize > 1 ? Math.min(5, Math.floor(grainSize / 10)) : 0

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

  const noiseTexA = device.createTexture({
    size: { width: w, height: h },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

  const noiseParamsBuf = createUniformBuffer(device, 16)
  writeUniformBuffer(device, noiseParamsBuf, new Uint32Array([seed >>> 0, 0, 0, 0]))

  const encoder = device.createCommandEncoder()

  // Pass 1: Generate noise → noiseTexA
  const noisePass = encoder.beginComputePass()
  noisePass.setPipeline(noisePipeline)
  noisePass.setBindGroup(0, device.createBindGroup({
    layout: noisePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: noiseTexA.createView() },
      { binding: 1, resource: { buffer: noiseParamsBuf } },
    ],
  }))
  noisePass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
  noisePass.end()

  let finalNoiseTex: GPUTexture
  let noiseTexB: GPUTexture | null = null
  let boxParamsBuf: GPUBuffer | null = null

  if (blurRadius > 0) {
    noiseTexB = device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    boxParamsBuf = createUniformBuffer(device, 16)
    writeUniformBuffer(device, boxParamsBuf, new Uint32Array([blurRadius, 0, 0, 0]))

    // Pass 2: Box H — noiseTexA (rgba8unorm) → intermediate0 (rgba16float)
    const bHPass = encoder.beginComputePass()
    bHPass.setPipeline(boxH)
    bHPass.setBindGroup(0, device.createBindGroup({
      layout: boxH.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: noiseTexA.createView() },
        { binding: 1, resource: intermediate0.createView() },
        { binding: 2, resource: { buffer: boxParamsBuf } },
      ],
    }))
    bHPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    bHPass.end()

    // Pass 3: Box V — intermediate0 (rgba16float) → noiseTexB (rgba8unorm)
    const bVPass = encoder.beginComputePass()
    bVPass.setPipeline(boxV)
    bVPass.setBindGroup(0, device.createBindGroup({
      layout: boxV.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: intermediate0.createView() },
        { binding: 1, resource: noiseTexB.createView() },
        { binding: 2, resource: { buffer: boxParamsBuf } },
      ],
    }))
    bVPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
    bVPass.end()

    finalNoiseTex = noiseTexB
  } else {
    finalNoiseTex = noiseTexA
  }

  // Final pass: Combine
  const outTex = device.createTexture({
    size: { width: w, height: h },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })

  const combineParamsBuf = createUniformBuffer(device, 16)
  writeUniformBuffer(device, combineParamsBuf, new Uint32Array([intensity, roughness, 0, 0]))

  const combinePass = encoder.beginComputePass()
  combinePass.setPipeline(combinePipeline)
  combinePass.setBindGroup(0, device.createBindGroup({
    layout: combinePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: finalNoiseTex.createView() },
      { binding: 2, resource: outTex.createView() },
      { binding: 3, resource: { buffer: combineParamsBuf } },
    ],
  }))
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
  noiseTexA.destroy()
  noiseTexB?.destroy()
  outTex.destroy()
  noiseParamsBuf.destroy()
  boxParamsBuf?.destroy()
  combineParamsBuf.destroy()
  readbuf.destroy()

  return result
}
