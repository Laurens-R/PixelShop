import { useRef, useEffect, useCallback } from 'react'
import { WebGPURenderer, type GpuLayer } from '@/webgpu/WebGPURenderer'

interface UseWebGLOptions {
  pixelWidth: number
  pixelHeight: number
}

interface UseWebGLReturn {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  rendererRef: React.RefObject<WebGPURenderer | null>
  createLayer: (id: string, name: string) => GpuLayer | null
  render: (layers: GpuLayer[], maskMap?: Map<string, GpuLayer>) => void
}

export function useWebGL({ pixelWidth, pixelHeight }: UseWebGLOptions): UseWebGLReturn {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<WebGPURenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let mounted = true
    WebGPURenderer.create(canvas, pixelWidth, pixelHeight)
      .then(renderer => {
        if (!mounted) {
          renderer.destroy()
          return
        }
        rendererRef.current = renderer
      })
      .catch(err => {
        console.error('[useWebGL] Failed to initialize WebGPU renderer:', err)
      })

    return () => {
      mounted = false
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [pixelWidth, pixelHeight])

  const createLayer = useCallback(
    (id: string, name: string): GpuLayer | null =>
      rendererRef.current?.createLayer(id, name) ?? null,
    []
  )

  const render = useCallback((layers: GpuLayer[], maskMap?: Map<string, GpuLayer>): void => {
    rendererRef.current?.render(layers, maskMap)
  }, [])

  return { canvasRef, rendererRef, createLayer, render }
}
