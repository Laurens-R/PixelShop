import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../utils'

export const FILTER_MEDIAN_COMPUTE = /* wgsl */ `
struct MedianParams {
  radius : u32,
  _pad0  : u32,
  _pad1  : u32,
  _pad2  : u32,
}

@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var dstTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : MedianParams;

var<private> vals: array<f32, 441>;

fn insertionSort(n: u32) {
  for (var i = 1u; i < n; i++) {
    let key = vals[i];
    var j = i32(i) - 1;
    loop {
      if (j < 0 || vals[u32(j)] <= key) { break; }
      vals[u32(j) + 1u] = vals[u32(j)];
      j = j - 1;
    }
    vals[u32(j + 1)] = key;
  }
}

@compute @workgroup_size(8, 8)
fn cs_median(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(srcTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let r   = min(params.radius, 10u);
  let n   = (2u * r + 1u) * (2u * r + 1u);
  let mid = n / 2u;

  let orig = textureLoad(srcTex, vec2i(id.xy), 0);

  // Collect + sort R
  var count = 0u;
  for (var ky = -i32(r); ky <= i32(r); ky++) {
    for (var kx = -i32(r); kx <= i32(r); kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      vals[count] = textureLoad(srcTex, vec2i(sx, sy), 0).r;
      count += 1u;
    }
  }
  insertionSort(n);
  let medR = vals[mid];

  // Collect + sort G
  count = 0u;
  for (var ky = -i32(r); ky <= i32(r); ky++) {
    for (var kx = -i32(r); kx <= i32(r); kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      vals[count] = textureLoad(srcTex, vec2i(sx, sy), 0).g;
      count += 1u;
    }
  }
  insertionSort(n);
  let medG = vals[mid];

  // Collect + sort B
  count = 0u;
  for (var ky = -i32(r); ky <= i32(r); ky++) {
    for (var kx = -i32(r); kx <= i32(r); kx++) {
      let sx = clamp(i32(id.x) + kx, 0, i32(dims.x) - 1);
      let sy = clamp(i32(id.y) + ky, 0, i32(dims.y) - 1);
      vals[count] = textureLoad(srcTex, vec2i(sx, sy), 0).b;
      count += 1u;
    }
  }
  insertionSort(n);
  let medB = vals[mid];

  textureStore(dstTex, vec2i(id.xy), vec4f(medR, medG, medB, orig.a));
}
` as const

export async function runMedian(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
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
