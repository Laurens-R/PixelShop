import { useRef, useEffect, useCallback } from 'react'
import { WebGLRenderer, type WebGLLayer } from '@/webgl/WebGLRenderer'

interface UseWebGLOptions {
  pixelWidth: number
  pixelHeight: number
}

interface UseWebGLReturn {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  rendererRef: React.RefObject<WebGLRenderer | null>
  createLayer: (id: string, name: string) => WebGLLayer | null
  render: (layers: WebGLLayer[], maskMap?: Map<string, WebGLLayer>) => void
}

export function useWebGL({ pixelWidth, pixelHeight }: UseWebGLOptions): UseWebGLReturn {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      rendererRef.current = new WebGLRenderer(canvas, pixelWidth, pixelHeight)
    } catch (err) {
      console.error('[useWebGL] Failed to initialize renderer:', err)
    }

    return () => {
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [pixelWidth, pixelHeight])

  const createLayer = useCallback(
    (id: string, name: string): WebGLLayer | null =>
      rendererRef.current?.createLayer(id, name) ?? null,
    []
  )

  const render = useCallback((layers: WebGLLayer[], maskMap?: Map<string, WebGLLayer>): void => {
    rendererRef.current?.render(layers, maskMap)
  }, [])

  return { canvasRef, rendererRef, createLayer, render }
}
