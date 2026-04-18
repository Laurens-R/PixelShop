// ─── Texture helpers ──────────────────────────────────────────────────────────

export function createGpuTexture(
  device: GPUDevice,
  width: number,
  height: number,
  data?: Uint8Array | null,
  format: GPUTextureFormat = 'rgba8unorm',
  usage: GPUTextureUsageFlags =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_DST |
    GPUTextureUsage.COPY_SRC |
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.RENDER_ATTACHMENT,
): GPUTexture {
  const texture = device.createTexture({
    size: { width, height },
    format,
    usage,
  })
  if (data) {
    uploadTextureData(device, texture, width, height, data)
  }
  return texture
}

export function uploadTextureData(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  data: Uint8Array,
): void {
  device.queue.writeTexture(
    { texture },
    data as Uint8Array<ArrayBuffer>,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height },
  )
}

export function uploadR8TextureData(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  data: Uint8Array,
): void {
  device.queue.writeTexture(
    { texture },
    data as Uint8Array<ArrayBuffer>,
    { bytesPerRow: width, rowsPerImage: height },
    { width, height },
  )
}

// ─── Buffer helpers ───────────────────────────────────────────────────────────

export function createUniformBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
}

export function writeUniformBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  data: ArrayBuffer | Float32Array | Uint32Array,
): void {
  const src = data instanceof ArrayBuffer ? data : (data.buffer as ArrayBuffer)
  device.queue.writeBuffer(buffer, 0, src)
}

export function createVertexBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, data as Float32Array<ArrayBuffer>)
  return buffer
}

export function createReadbackBuffer(device: GPUDevice, byteSize: number): GPUBuffer {
  return device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
}
