import { createUniformBuffer, writeUniformBuffer, createReadbackBuffer, unpackRows } from '../../utils'

export const FILTER_PIXELATE_COMPUTE = /* wgsl */ `
struct PixelateParams {
  blockSize : u32,
  width     : u32,
  height    : u32,
  _pad      : u32,
}

@group(0) @binding(0) var srcTex          : texture_2d<f32>;
@group(0) @binding(1) var dstTex          : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : PixelateParams;

// Each invocation handles one block (column blockX = id.x, row blockY = id.y).
// Dispatch count: (ceil(ceil(W/S) / 8), ceil(ceil(H/S) / 8), 1).
@compute @workgroup_size(8, 8)
fn cs_pixelate(@builtin(global_invocation_id) id: vec3u) {
  let S  = params.blockSize;
  let w  = params.width;
  let h  = params.height;

  // Block origin in image space
  let bx = id.x * S;
  let by = id.y * S;
  if (bx >= w || by >= h) { return; }

  // Inclusive extent, clamped for partial edge blocks
  let ex = min(bx + S, w);
  let ey = min(by + S, h);

  var sum   = vec4f(0.0);
  var count = 0u;

  for (var py = by; py < ey; py++) {
    for (var px = bx; px < ex; px++) {
      sum   += textureLoad(srcTex, vec2u(px, py), 0);
      count += 1u;
    }
  }

  let avg = sum / f32(count);

  for (var py = by; py < ey; py++) {
    for (var px = bx; px < ex; px++) {
      textureStore(dstTex, vec2u(px, py), avg);
    }
  }
}
` as const

export async function runPixelate(
  device:    GPUDevice,
  pipeline:  GPUComputePipeline,
  pixels:    Uint8Array,
  w:         number,
  h:         number,
  blockSize: number,
): Promise<Uint8Array> {
  const srcTex = device.createTexture({
    size:   { width: w, height: h },
    format: 'rgba8unorm',
    usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: srcTex },
    pixels as Uint8Array<ArrayBuffer>,
    { bytesPerRow: w * 4, rowsPerImage: h },
    { width: w, height: h },
  )

  const outTex = device.createTexture({
    size:   { width: w, height: h },
    format: 'rgba8unorm',
    usage:  GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })

  const paramsData = new Uint32Array([blockSize, w, h, 0])
  const paramsBuf  = createUniformBuffer(device, 16)
  writeUniformBuffer(device, paramsBuf, paramsData)

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: outTex.createView() },
      { binding: 2, resource: { buffer: paramsBuf } },
    ],
  })

  const blockCountX = Math.ceil(w / blockSize)
  const blockCountY = Math.ceil(h / blockSize)

  const encoder = device.createCommandEncoder()
  const pass    = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(blockCountX / 8), Math.ceil(blockCountY / 8))
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
