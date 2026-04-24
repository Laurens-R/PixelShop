import { ipcMain, app, BrowserWindow } from 'electron'
import { join, dirname } from 'node:path'
import { access, mkdir, rename, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { request } from 'node:https'
import type { IpcMainInvokeEvent } from 'electron'
import type { IncomingMessage } from 'node:http'

// ─── ORT type stubs (mirror of sam.ts) ───────────────────────────────────────

interface OrtTensor {
  readonly data: Float32Array | Int32Array | BigInt64Array | Uint8Array
  readonly dims: ReadonlyArray<number>
}

interface OrtTensorConstructor {
  new (type: 'float32', data: Float32Array, dims: number[]): OrtTensor
}

interface OrtInferenceSession {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}

interface OrtModule {
  InferenceSession: {
    create(
      path: string,
      options?: { executionProviders?: string[] },
    ): Promise<OrtInferenceSession>
  }
  Tensor: OrtTensorConstructor
}

const _require = createRequire(import.meta.url)
let _ort: OrtModule | null = null
function getOrt(): OrtModule {
  if (!_ort) _ort = _require('onnxruntime-node') as OrtModule
  return _ort
}

// ─── Model location ──────────────────────────────────────────────────────────
// Dev:  <root>/resources/models/rvm/rvm_mobilenetv3_fp32.onnx
// Prod: process.resourcesPath/models/rvm/rvm_mobilenetv3_fp32.onnx
// Downloaded copies live in app.getPath('userData')/models/rvm/ and are
// preferred over the bundled location (so users can update without reinstall).

const MODEL_FILE = 'rvm_mobilenetv3_fp32.onnx'
const MODEL_URL = 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx'

function getBundledModelPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'models', 'rvm', MODEL_FILE)
  }
  const devRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  return join(devRoot, 'resources', 'models', 'rvm', MODEL_FILE)
}

function getUserDataModelPath(): string {
  return join(app.getPath('userData'), 'models', 'rvm', MODEL_FILE)
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

async function resolveModelPath(): Promise<string | null> {
  const userPath = getUserDataModelPath()
  if (await fileExists(userPath)) return userPath
  const bundled = getBundledModelPath()
  if (await fileExists(bundled)) return bundled
  return null
}

// ─── Session ─────────────────────────────────────────────────────────────────

let session: OrtInferenceSession | null = null
let sessionLogged = false

async function loadSession(): Promise<void> {
  if (session) return
  const path = await resolveModelPath()
  if (!path) throw new Error('RVM model file not found')
  const ort = getOrt()
  session = await ort.InferenceSession.create(path, { executionProviders: ['cpu'] })
  if (!sessionLogged) {
    sessionLogged = true
    // eslint-disable-next-line no-console
    console.log('[matting] RVM loaded. inputs=', session.inputNames, 'outputs=', session.outputNames)
  }
}

// ─── Download with progress ──────────────────────────────────────────────────

function httpsGetFollow(url: string, onResponse: (res: IncomingMessage) => void, onError: (e: Error) => void, depth = 0): void {
  if (depth > 5) { onError(new Error('Too many redirects')); return }
  const req = request(url, { method: 'GET' }, (res) => {
    const status = res.statusCode ?? 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume()
      const next = new URL(res.headers.location, url).toString()
      httpsGetFollow(next, onResponse, onError, depth + 1)
      return
    }
    if (status !== 200) {
      onError(new Error(`HTTP ${status}`))
      res.resume()
      return
    }
    onResponse(res)
  })
  req.on('error', onError)
  req.end()
}

async function downloadModelFile(onProgress: (loaded: number, total: number) => void): Promise<void> {
  const finalPath = getUserDataModelPath()
  const tmpPath = finalPath + '.part'
  await mkdir(dirname(finalPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    httpsGetFollow(
      MODEL_URL,
      (res) => {
        const total = parseInt(res.headers['content-length'] ?? '0', 10) || 0
        let loaded = 0
        const out = createWriteStream(tmpPath)
        res.on('data', (chunk: Buffer) => {
          loaded += chunk.length
          onProgress(loaded, total)
        })
        res.pipe(out)
        out.on('finish', () => {
          out.close((err) => err ? reject(err) : resolve())
        })
        out.on('error', reject)
      },
      reject,
    )
  })

  // Sanity-check size (RVM mobilenetv3 fp32 is ~14 MB). Anything tiny is
  // almost certainly an HTML error page or redirect failure.
  const { stat } = await import('node:fs/promises')
  const sz = (await stat(tmpPath)).size
  if (sz < 1_000_000) {
    try { await unlink(tmpPath) } catch { /* ignore */ }
    throw new Error(`Downloaded file is too small (${sz} bytes) — likely a redirect or error page`)
  }

  // Atomic rename so a partial file is never picked up by resolveModelPath().
  try { await unlink(finalPath) } catch { /* ignore */ }
  await rename(tmpPath, finalPath)
}

// ─── Refinement ──────────────────────────────────────────────────────────────

interface RefineParams {
  imageRgba: Buffer        // RGBA crop, length = width*height*4
  width: number
  height: number
  selectionMask: Buffer    // 0–255, length = width*height (cropped to same region)
  bandRadius: number       // pixels — width of the "unknown" band around selection edge
}

interface RefineResult {
  alpha: Buffer            // 0–255, length = width*height
}

/** Pad a value up to the next multiple of `mult`. */
function ceilTo(v: number, mult: number): number {
  return Math.ceil(v / mult) * mult
}

/**
 * Pack RGBA (HWC, uint8) into CHW float32 in [0,1], padding W and H with edge
 * replication to multiples of 4 (RVM downsamples 4× internally and requires
 * dimensions divisible by 4).
 */
function rgbaToChwPadded(
  rgba: Buffer, w: number, h: number,
): { tensor: Float32Array; pw: number; ph: number } {
  const pw = ceilTo(w, 4)
  const ph = ceilTo(h, 4)
  const tensor = new Float32Array(3 * pw * ph)
  const planeSize = pw * ph
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(y, h - 1)
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(x, w - 1)
      const i = (sy * w + sx) * 4
      const o = y * pw + x
      tensor[o            ] = rgba[i    ] / 255
      tensor[o + planeSize] = rgba[i + 1] / 255
      tensor[o + 2 * planeSize] = rgba[i + 2] / 255
    }
  }
  return { tensor, pw, ph }
}

/**
 * In-place morphological dilate (max filter, square kernel) on a 0–255 mask.
 * Used to produce trimap "outer" and "inner" boundaries.
 */
function dilate(mask: Uint8Array, w: number, h: number, r: number, threshold = 128): Uint8Array {
  if (r <= 0) return mask
  const tmp = new Uint8Array(w * h)
  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let any = 0
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r)
      for (let xi = x0; xi <= x1; xi++) {
        if (mask[y * w + xi] >= threshold) { any = 255; break }
      }
      tmp[y * w + x] = any
    }
  }
  const out = new Uint8Array(w * h)
  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let any = 0
      const y0 = Math.max(0, y - r)
      const y1 = Math.min(h - 1, y + r)
      for (let yi = y0; yi <= y1; yi++) {
        if (tmp[yi * w + x] >= threshold) { any = 255; break }
      }
      out[y * w + x] = any
    }
  }
  return out
}

function erode(mask: Uint8Array, w: number, h: number, r: number, threshold = 128): Uint8Array {
  // Erode = invert → dilate → invert
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] >= threshold ? 0 : 255
  const dil = dilate(inv, w, h, r)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < dil.length; i++) out[i] = dil[i] >= threshold ? 0 : 255
  return out
}

async function runRvm(rgba: Buffer, width: number, height: number): Promise<Float32Array> {
  await loadSession()
  const ort = getOrt()
  const { tensor: src, pw, ph } = rgbaToChwPadded(rgba, width, height)

  // RVM downsample_ratio guidance from the model card:
  //   4K → 0.125,  1080p → 0.25,  720p → 0.4,  ≤512px → 1.0
  const longest = Math.max(pw, ph)
  const downsampleRatio =
    longest <= 512  ? 1.0  :
    longest <= 1024 ? 0.5  :
    longest <= 1920 ? 0.4  :
    longest <= 2560 ? 0.25 : 0.125

  // Recurrent state: pass tiny zero tensors for first-frame inference.
  // RVM accepts dynamic shapes; the network resizes internally.
  const zeroState = (): OrtTensor =>
    new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])

  const feeds: Record<string, OrtTensor> = {
    src: new ort.Tensor('float32', src, [1, 3, ph, pw]),
    r1i: zeroState(),
    r2i: zeroState(),
    r3i: zeroState(),
    r4i: zeroState(),
    downsample_ratio: new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1]),
  }

  const filtered: Record<string, OrtTensor> = {}
  for (const name of session!.inputNames) {
    if (name in feeds) filtered[name] = feeds[name]
  }

  const out = await session!.run(filtered)
  const phaName = 'pha' in out ? 'pha' : (session!.outputNames.find((n) => n.toLowerCase().includes('pha')) ?? '')
  const phaTensor = out[phaName]
  if (!phaTensor) throw new Error(`RVM output "pha" not found. Available: ${session!.outputNames.join(', ')}`)

  const pha = phaTensor.data as Float32Array
  const dims = phaTensor.dims
  // Expect [1, 1, H, W]; fall back to using the last two dims as H,W.
  const phaH = dims[dims.length - 2]
  const phaW = dims[dims.length - 1]

  // Diagnostics: alpha statistics so it's obvious if the model returns garbage.
  let amin = Infinity, amax = -Infinity, asum = 0
  for (let i = 0; i < pha.length; i++) {
    const v = pha[i]
    if (v < amin) amin = v
    if (v > amax) amax = v
    asum += v
  }
  // eslint-disable-next-line no-console
  console.log(
    `[matting] RVM in=${width}×${height} pad=${pw}×${ph} ds=${downsampleRatio} → pha dims=[${dims.join(',')}] (${phaW}×${phaH}) min=${amin.toFixed(3)} max=${amax.toFixed(3)} mean=${(asum / pha.length).toFixed(3)}`,
  )

  if (phaH !== ph || phaW !== pw) {
    // RVM should return at the input resolution; if it doesn't we'd silently
    // index out-of-bounds. Surface the discrepancy.
    throw new Error(`RVM pha dims ${phaW}×${phaH} ≠ input ${pw}×${ph}`)
  }

  // Crop padded pha back to original size using the actual stride.
  const cropped = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cropped[y * width + x] = pha[y * phaW + x]
    }
  }
  return cropped
}

// ─── IPC handler registration ────────────────────────────────────────────────

export function registerMattingHandlers(): void {
  ipcMain.handle('matting:check-model', async (): Promise<{ ready: boolean; path: string | null }> => {
    const path = await resolveModelPath()
    return { ready: path !== null, path }
  })

  ipcMain.handle('matting:download-model', async (event: IpcMainInvokeEvent): Promise<{ success: true } | { error: string }> => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    const emit = (loaded: number, total: number): void => {
      sender?.webContents.send('matting:download-progress', {
        progress: total > 0 ? loaded / total : 0,
        loaded,
        total,
      })
    }
    try {
      await downloadModelFile(emit)
      // Reset session so next refine call loads the freshly downloaded model.
      session = null
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'matting:refine',
    async (_event: IpcMainInvokeEvent, params: RefineParams): Promise<RefineResult> => {
      const { width, height, bandRadius } = params
      if (params.imageRgba.length !== width * height * 4) {
        throw new Error(`imageRgba length ${params.imageRgba.length} ≠ ${width}×${height}×4`)
      }
      if (params.selectionMask.length !== width * height) {
        throw new Error(`selectionMask length ${params.selectionMask.length} ≠ ${width}×${height}`)
      }

      const rvmAlpha = await runRvm(params.imageRgba, width, height)

      // Build trimap from selection mask:
      //   inner  = erode(selection, bandRadius)   → definitely foreground
      //   outer  = dilate(selection, bandRadius)  → outside this is definitely bg
      //   band   = outer & ¬inner                 → unknown, take alpha from RVM
      const sel = new Uint8Array(params.selectionMask.buffer, params.selectionMask.byteOffset, params.selectionMask.byteLength)
      const inner = erode(sel, width, height, bandRadius)
      const outer = dilate(sel, width, height, bandRadius)

      let nInner = 0, nOuter = 0, nBand = 0
      const out = new Uint8Array(width * height)
      for (let i = 0; i < out.length; i++) {
        if (inner[i] >= 128) {
          out[i] = 255
          nInner++
        } else if (outer[i] < 128) {
          out[i] = 0
        } else {
          const a = rvmAlpha[i]
          out[i] = Math.max(0, Math.min(255, Math.round(a * 255)))
          nBand++
        }
        if (outer[i] >= 128) nOuter++
      }
      // eslint-disable-next-line no-console
      console.log(
        `[matting] trimap band=${bandRadius}px innerFG=${nInner}px bandUnknown=${nBand}px totalOuter=${nOuter}px (of ${width * height})`,
      )

      return { alpha: Buffer.from(out) }
    },
  )

  ipcMain.handle('matting:invalidate-session', (): void => {
    session = null
  })
}
