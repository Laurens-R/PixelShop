import { rasterizeWithGpu } from './GpuRasterPipeline'
import {
  type RasterizeDocumentRequest,
  type RasterizeDocumentResult,
} from './types'

export function rasterizeDocument(request: RasterizeDocumentRequest): RasterizeDocumentResult {
  return rasterizeWithGpu(request)
}
