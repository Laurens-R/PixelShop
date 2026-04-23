import * as UTIF from 'utif'

// ─── Supported image extensions + MIME types ─────────────────────────────────

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tga', '.tif', '.tiff'])

export const EXT_TO_MIME: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.bmp':  'image/bmp',
  '.tga':  'image/tga',
  '.tif':  'image/tiff',
  '.tiff': 'image/tiff',
}

// ─── TGA decoder ─────────────────────────────────────────────────────────────

function decodeTgaPixels(raw: Uint8Array): { data: Uint8Array; width: number; height: number } {
  const idLength      = raw[0]
  const imageType     = raw[2]
  // Bytes 5–6: color map length; byte 7: color map entry size (bits)
  const cmEntries     = raw[5] | (raw[6] << 8)
  const cmEntrySize   = raw[7]
  const cmBytes       = Math.ceil(cmEntries * cmEntrySize / 8)
  const width         = raw[12] | (raw[13] << 8)
  const height        = raw[14] | (raw[15] << 8)
  const pixelDepth    = raw[16]
  const descriptor    = raw[17]
  const topToBottom   = !!(descriptor & 0x20)
  const bytesPerPixel = Math.ceil(pixelDepth / 8)
  const pixelStart    = 18 + idLength + cmBytes
  const isGray        = imageType === 3 || imageType === 11
  const output        = new Uint8Array(width * height * 4)

  function writePixel(dstOff: number, srcOff: number): void {
    if (isGray) {
      const v = raw[srcOff]
      output[dstOff] = output[dstOff + 1] = output[dstOff + 2] = v
      output[dstOff + 3] = 255
    } else {
      // TGA stores BGR(A)
      output[dstOff]     = raw[srcOff + 2]  // R
      output[dstOff + 1] = raw[srcOff + 1]  // G
      output[dstOff + 2] = raw[srcOff + 0]  // B
      output[dstOff + 3] = bytesPerPixel === 4 ? raw[srcOff + 3] : 255
    }
  }

  if (imageType === 2 || imageType === 3) {
    for (let i = 0; i < width * height; i++) {
      writePixel(i * 4, pixelStart + i * bytesPerPixel)
    }
  } else if (imageType === 10 || imageType === 11) {
    let srcOff = pixelStart
    let dstPx  = 0
    while (dstPx < width * height) {
      const packet = raw[srcOff++]
      const count  = (packet & 0x7F) + 1
      if (packet & 0x80) {
        // Run-length packet: same pixel repeated
        const pixSrc = srcOff
        srcOff += bytesPerPixel
        for (let j = 0; j < count; j++) writePixel((dstPx++) * 4, pixSrc)
      } else {
        // Raw packet: count distinct pixels
        for (let j = 0; j < count; j++) {
          writePixel((dstPx++) * 4, srcOff)
          srcOff += bytesPerPixel
        }
      }
    }
  } else {
    throw new Error(`Unsupported TGA image type: ${imageType}`)
  }

  // TGA default scan order is bottom-to-top; flip unless bit 5 of descriptor is set
  if (!topToBottom) {
    const rowBytes = width * 4
    const tmp = new Uint8Array(rowBytes)
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const topOff = y * rowBytes
      const botOff = (height - 1 - y) * rowBytes
      tmp.set(output.subarray(topOff, topOff + rowBytes))
      output.copyWithin(topOff, botOff, botOff + rowBytes)
      output.set(tmp, botOff)
    }
  }

  return { data: output, width, height }
}

// ─── Decode a data URL into raw RGBA pixels ───────────────────────────────────

export function loadImagePixels(dataUrl: string): Promise<{ data: Uint8Array; width: number; height: number }> {
  // TGA is not supported by the browser's <img> element — decode manually.
  if (dataUrl.startsWith('data:image/tga;base64,')) {
    try {
      const base64 = dataUrl.slice('data:image/tga;base64,'.length)
      const binary = atob(base64)
      const bytes  = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return Promise.resolve(decodeTgaPixels(bytes))
    } catch (err) {
      return Promise.reject(new Error(`Failed to decode TGA: ${(err as Error).message}`))
    }
  }

  // TIFF is not supported by the browser's <img> element — decode via UTIF.
  if (dataUrl.startsWith('data:image/tiff;base64,')) {
    try {
      const base64  = dataUrl.slice('data:image/tiff;base64,'.length)
      const binary  = atob(base64)
      const bytes   = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const ifds    = UTIF.decode(bytes.buffer as ArrayBuffer)
      if (ifds.length === 0) throw new Error('No images found in TIFF file')
      UTIF.decodeImage(bytes.buffer as ArrayBuffer, ifds[0])
      const rgba    = UTIF.toRGBA8(ifds[0])
      return Promise.resolve({ data: rgba, width: ifds[0].width, height: ifds[0].height })
    } catch (err) {
      return Promise.reject(new Error(`Failed to decode TIFF: ${(err as Error).message}`))
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const tmp = document.createElement('canvas')
      tmp.width = img.naturalWidth
      tmp.height = img.naturalHeight
      const ctx = tmp.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve({
        data: new Uint8Array(ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data.buffer),
        width: img.naturalWidth,
        height: img.naturalHeight,
      })
    }
    img.onerror = () => reject(new Error('Failed to decode image'))
    img.src = dataUrl
  })
}
