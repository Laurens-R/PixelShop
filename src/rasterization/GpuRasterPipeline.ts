import {
  RasterizationUnavailableError,
  type RasterizeDocumentRequest,
  type RasterizeDocumentResult,
} from './types'

export function rasterizeWithGpu(request: RasterizeDocumentRequest): RasterizeDocumentResult {
  const renderer = request.renderer
  if (!renderer) {
    throw new RasterizationUnavailableError('GPU rasterization is unavailable because no renderer is bound.')
  }

  const data = renderer.readFlattenedPlan(request.plan)

  return {
    data,
    width: renderer.pixelWidth,
    height: renderer.pixelHeight,
    backendUsed: 'gpu',
  }
}
