// ─── Supported image extensions + MIME types ─────────────────────────────────

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export const EXT_TO_MIME: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.bmp':  'image/bmp',
}

// ─── Decode a data URL into raw RGBA pixels ───────────────────────────────────

export function loadImagePixels(dataUrl: string): Promise<{ data: Uint8Array; width: number; height: number }> {
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
