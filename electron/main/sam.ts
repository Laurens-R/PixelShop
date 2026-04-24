import { ipcMain, app } from 'electron'
import { join, dirname } from 'node:path'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'

// ─── Minimal ORT type stubs ───────────────────────────────────────────────────
// onnxruntime-node ships its own .d.ts; we define a minimal interface here so
// TypeScript does not need the package installed at compile time. At runtime the
// real module is loaded via createRequire.

interface OrtTensor {
  readonly data: Float32Array | Int32Array | BigInt64Array | Uint8Array
  readonly dims: ReadonlyArray<number>
}

interface OrtTensorConstructor {
  new (type: 'float32', data: Float32Array, dims: number[]): OrtTensor
  new (type: 'int64', data: BigInt64Array, dims: number[]): OrtTensor
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

// ─── Model paths ─────────────────────────────────────────────────────────────
// In dev: models live at <project root>/resources/models/mobilesam/
// In prod: models are copied to app.asar.unpacked or next to resources via
//          extraResources, accessible at process.resourcesPath/models/mobilesam/

function getModelsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'models', 'mobilesam')
  }
  // In dev, electron-vite compiles main to out/main/index.js;
  // project root is 2 levels up from that file.
  const devRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  return join(devRoot, 'resources', 'models', 'mobilesam')
}
function getEncoderPath(): string {
  return join(getModelsDir(), 'encoder.onnx')
}
function getDecoderPath(): string {
  return join(getModelsDir(), 'decoder.onnx')
}

// ─── Runtime-loaded ONNX ─────────────────────────────────────────────────────

const _require = createRequire(import.meta.url)
let _ort: OrtModule | null = null

function getOrt(): OrtModule {
  if (!_ort) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    _ort = _require('onnxruntime-node') as OrtModule
  }
  return _ort
}

// ─── Session and embedding cache ─────────────────────────────────────────────

let encoderSession: OrtInferenceSession | null = null
let decoderSession: OrtInferenceSession | null = null
let cachedEmbeddings: Float32Array | null = null

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadSessions(): Promise<void> {
  if (encoderSession && decoderSession) return
  const ort = getOrt()
  if (!encoderSession) {
    encoderSession = await ort.InferenceSession.create(getEncoderPath(), {
      executionProviders: ['cpu'],
    })
  }
  if (!decoderSession) {
    decoderSession = await ort.InferenceSession.create(getDecoderPath(), {
      executionProviders: ['cpu'],
    })
  }
}

function preprocessImage(rgba: Buffer): Float32Array {
  const MEAN = [0.485, 0.456, 0.406]
  const STD = [0.229, 0.224, 0.225]
  const n = 1024 * 1024
  // Channel-last (HWC) layout: [1024, 1024, 3]
  const tensor = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    tensor[i * 3 + 0] = (rgba[i * 4 + 0] / 255.0 - MEAN[0]) / STD[0]
    tensor[i * 3 + 1] = (rgba[i * 4 + 1] / 255.0 - MEAN[1]) / STD[1]
    tensor[i * 3 + 2] = (rgba[i * 4 + 2] / 255.0 - MEAN[2]) / STD[2]
  }
  return tensor
}

// ─── IPC handler registration ─────────────────────────────────────────────────

export function registerSamHandlers(): void {
  ipcMain.handle(
    'sam:check-model',
    async (): Promise<{ encoderReady: boolean; decoderReady: boolean }> => {
      const [encoderReady, decoderReady] = await Promise.all([
        fileExists(getEncoderPath()),
        fileExists(getDecoderPath()),
      ])
      return { encoderReady, decoderReady }
    },
  )

  ipcMain.handle(
    'sam:encode-image',
    async (
      _event: IpcMainInvokeEvent,
      imageData: Buffer,
      _origWidth: number,
      _origHeight: number,
    ): Promise<{ embeddings: Buffer }> => {
      await loadSessions()
      const ort = getOrt()

      const floatData = preprocessImage(imageData)
      // PulpCut/mobilesam-onnx encoder expects channel-last HWC: [1024, 1024, 3]
      const inputTensor = new ort.Tensor('float32', floatData, [1024, 1024, 3])
      const feeds: Record<string, OrtTensor> = {}
      feeds[encoderSession!.inputNames[0]] = inputTensor
      const results = await encoderSession!.run(feeds)

      const embKey =
        encoderSession!.outputNames.find((n) => n.includes('embedding')) ??
        encoderSession!.outputNames[0]
      const embTensor = results[embKey]
      const embData = new Float32Array(embTensor.data as Float32Array)

      cachedEmbeddings = embData

      return { embeddings: Buffer.from(embData.buffer) }
    },
  )

  ipcMain.handle(
    'sam:decode-mask',
    async (
      _event: IpcMainInvokeEvent,
      params: {
        embeddings: Buffer | null
        points: Array<{ x: number; y: number; positive: boolean }>
        box: { x1: number; y1: number; x2: number; y2: number } | null
        origWidth: number
        origHeight: number
      },
    ): Promise<{ mask: Buffer; width: number; height: number; iouScore: number }> => {
      await loadSessions()
      const ort = getOrt()

      let embedData: Float32Array
      if (params.embeddings !== null) {
        embedData = new Float32Array(
          params.embeddings.buffer,
          params.embeddings.byteOffset,
          params.embeddings.byteLength / 4,
        )
      } else if (cachedEmbeddings) {
        embedData = cachedEmbeddings
      } else {
        throw new Error('No embeddings available. Call sam:encode-image first.')
      }

      const scale = 1024 / Math.max(params.origWidth, params.origHeight)

      const promptCoords: number[] = []
      const promptLabels: number[] = []

      if (params.box !== null) {
        promptCoords.push(params.box.x1 * scale, params.box.y1 * scale)
        promptLabels.push(2)
        promptCoords.push(params.box.x2 * scale, params.box.y2 * scale)
        promptLabels.push(3)
      }

      for (const pt of params.points) {
        promptCoords.push(pt.x * scale, pt.y * scale)
        promptLabels.push(pt.positive ? 1 : 0)
      }

      // Padding point required by SAM decoder
      promptCoords.push(0, 0)
      promptLabels.push(-1)

      const N = promptLabels.length

      const allFeeds: Record<string, OrtTensor> = {
        image_embeddings: new ort.Tensor('float32', embedData, [1, 256, 64, 64]),
        point_coords: new ort.Tensor('float32', new Float32Array(promptCoords), [1, N, 2]),
        point_labels: new ort.Tensor('float32', new Float32Array(promptLabels), [1, N]),
        mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
        has_mask_input: new ort.Tensor('float32', new Float32Array([0.0]), [1]),
        orig_im_size: new ort.Tensor('float32', new Float32Array([1024.0, 1024.0]), [2]),
      }

      // Only pass inputs the decoder actually expects (varies by ONNX export variant)
      const feeds: Record<string, OrtTensor> = {}
      for (const name of decoderSession!.inputNames) {
        if (name in allFeeds) feeds[name] = allFeeds[name]
      }

      const results = await decoderSession!.run(feeds)

      const iouTensor = results['iou_predictions']
      const lowResMasksTensor = results['low_res_masks']

      const iouData = iouTensor.data as Float32Array
      let bestIdx = 0
      let bestIou = iouData[0]
      for (let i = 1; i < iouData.length; i++) {
        if (iouData[i] > bestIou) {
          bestIou = iouData[i]
          bestIdx = i
        }
      }

      const masksData = lowResMasksTensor.data as Float32Array
      const pixelCount = 256 * 256
      const maskSlice = masksData.slice(bestIdx * pixelCount, (bestIdx + 1) * pixelCount)

      const uint8Mask = new Uint8Array(pixelCount)
      for (let i = 0; i < pixelCount; i++) {
        const val = 1.0 / (1.0 + Math.exp(-maskSlice[i]))
        uint8Mask[i] = Math.min(255, Math.max(0, Math.round(val * 255)))
      }

      return {
        mask: Buffer.from(uint8Mask),
        width: 256,
        height: 256,
        iouScore: bestIou,
      }
    },
  )

  ipcMain.handle('sam:invalidate-cache', (): void => {
    cachedEmbeddings = null
    // Reset sessions so models are reloaded if files changed
    encoderSession = null
    decoderSession = null
  })
}
