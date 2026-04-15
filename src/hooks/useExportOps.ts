import { useCallback, type MutableRefObject } from 'react'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'
import type { ExportSettings } from '@/components/dialogs/ExportDialog/ExportDialog'
import type { AppState } from '@/types'
import { exportPng } from '@/export/exportPng'
import { exportJpeg } from '@/export/exportJpeg'
import { exportWebp } from '@/export/exportWebp'
import { showOperationError } from '@/utils/userFeedback'

interface UseExportOpsOptions {
  canvasHandleRef: { readonly current: CanvasHandle | null }
  stateRef: MutableRefObject<AppState>
}

interface UseExportOpsReturn {
  handleExportConfirm: (settings: ExportSettings) => Promise<void>
}

export function useExportOps({
  canvasHandleRef,
  stateRef,
}: UseExportOpsOptions): UseExportOpsReturn {
  const handleExportConfirm = useCallback(async (settings: ExportSettings): Promise<void> => {
    try {
      const handle = canvasHandleRef.current
      if (!handle) throw new Error('Canvas renderer is not ready yet. Please try export again.')
      const flat = handle.rasterizeLayers(stateRef.current.layers, 'export')
      const { data, width, height } = flat
      let dataUrl: string
      if      (settings.format === 'png')  dataUrl = exportPng(data, width, height)
      else if (settings.format === 'webp') dataUrl = exportWebp(data, width, height, { quality: settings.webpQuality })
      else                                 dataUrl = exportJpeg(data, width, height, { quality: settings.jpegQuality, background: settings.jpegBackground })
      await window.api.exportImage(settings.filePath, dataUrl.replace(/^data:[^;]+;base64,/, ''))
    } catch (error) {
      console.error('[useExportOps] Export failed:', error)
      showOperationError('Export failed.', error)
    }
  }, [canvasHandleRef, stateRef])

  return { handleExportConfirm }
}