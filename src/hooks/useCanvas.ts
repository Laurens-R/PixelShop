import { useRef, useCallback } from 'react'

export interface CanvasPointerPosition {
  x: number
  y: number
  pressure: number
  shiftKey: boolean
  altKey: boolean
}

interface UseCanvasOptions {
  onPointerDown?: (pos: CanvasPointerPosition) => void
  onPointerMove?: (pos: CanvasPointerPosition) => void
  onPointerUp?: (pos: CanvasPointerPosition) => void
}

interface UseCanvasReturn {
  isDrawing: React.RefObject<boolean>
  handlePointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void
  handlePointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void
  handlePointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void
  handlePointerLeave: (e: React.PointerEvent<HTMLCanvasElement>) => void
}

export function useCanvas({
  onPointerDown,
  onPointerMove,
  onPointerUp
}: UseCanvasOptions): UseCanvasReturn {
  const isDrawing = useRef(false)

  const toCanvasPos = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): CanvasPointerPosition => {
      const rect = e.currentTarget.getBoundingClientRect()
      const scaleX = e.currentTarget.width / rect.width
      const scaleY = e.currentTarget.height / rect.height
      return {
        x: Math.floor((e.clientX - rect.left) * scaleX),
        y: Math.floor((e.clientY - rect.top) * scaleY),
        pressure: e.pressure,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      }
    },
    []
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      e.currentTarget.setPointerCapture(e.pointerId)
      isDrawing.current = true
      onPointerDown?.(toCanvasPos(e))
    },
    [toCanvasPos, onPointerDown]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (!isDrawing.current) return
      onPointerMove?.(toCanvasPos(e))
    },
    [toCanvasPos, onPointerMove]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (!isDrawing.current) return
      isDrawing.current = false
      onPointerUp?.(toCanvasPos(e))
    },
    [toCanvasPos, onPointerUp]
  )

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (!isDrawing.current) return
      isDrawing.current = false
      onPointerUp?.(toCanvasPos(e))
    },
    [toCanvasPos, onPointerUp]
  )

  return { isDrawing, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerLeave }
}
