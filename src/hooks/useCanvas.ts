import { useRef, useCallback } from 'react'

export interface CanvasPointerPosition {
  x: number
  y: number
  pressure: number
  shiftKey: boolean
  altKey: boolean
  timeStamp: number
}

interface UseCanvasOptions {
  onPointerDown?: (pos: CanvasPointerPosition) => void
  onPointerMove?: (pos: CanvasPointerPosition) => void
  onPointerUp?: (pos: CanvasPointerPosition) => void
  /** Fires on every pointermove regardless of button state — for hover effects. */
  onHover?: (pos: CanvasPointerPosition) => void
  /** Fires when the pointer leaves the canvas. */
  onLeave?: () => void
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
  onPointerUp,
  onHover,
  onLeave,
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
        timeStamp: e.timeStamp,
      }
    },
    []
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      // Only respond to primary button / pen tip (button 0).
      // Wacom barrel buttons and eraser end fire button 2/5 — ignore them here.
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      isDrawing.current = true
      onPointerDown?.(toCanvasPos(e))
    },
    [toCanvasPos, onPointerDown]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      // Detect pen tip lifted without firing pointerup (known Wacom/tablet quirk).
      // e.buttons bit 0 = primary button / pen tip is currently pressed.
      if (isDrawing.current && !(e.buttons & 1)) {
        isDrawing.current = false
        onPointerUp?.(toCanvasPos(e))
        return
      }

      // Use coalesced events for pen/touch only. High-polling-rate mice (1000Hz+)
      // produce 16+ coalesced events per frame — each triggers a full WebGL flush/render
      // and tanks performance. Mouse events are already delivered once-per-frame by the
      // browser, so the primary event is sufficient for mouse input.
      const coalesced = e.nativeEvent.pointerType !== 'mouse'
        ? e.nativeEvent.getCoalescedEvents?.()
        : null
      if (coalesced && coalesced.length > 0) {
        const rect = e.currentTarget.getBoundingClientRect()
        const sx = e.currentTarget.width / rect.width
        const sy = e.currentTarget.height / rect.height
        for (const ce of coalesced) {
          const pos: CanvasPointerPosition = {
            x: Math.floor((ce.clientX - rect.left) * sx),
            y: Math.floor((ce.clientY - rect.top) * sy),
            // Use primary event pressure for all coalesced samples — per-coalesced pressure
            // fluctuates at the hardware polling rate and causes visible size/opacity jitter.
            pressure: e.pressure,
            shiftKey: ce.shiftKey,
            altKey: ce.altKey,
            // Use the coalesced sample's own timestamp for correct velocity calculation;
            // coalesced events all fire in the same JS tick but have real hardware timestamps.
            timeStamp: ce.timeStamp,
          }
          onHover?.(pos)
          if (isDrawing.current) onPointerMove?.(pos)
        }
      } else {
        const pos = toCanvasPos(e)
        onHover?.(pos)
        if (isDrawing.current) onPointerMove?.(pos)
      }
    },
    [toCanvasPos, onPointerMove, onPointerUp, onHover]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      // Only end the stroke on primary button / pen tip release.
      if (e.button !== 0) return
      if (!isDrawing.current) return
      isDrawing.current = false
      onPointerUp?.(toCanvasPos(e))
    },
    [toCanvasPos, onPointerUp]
  )

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      onLeave?.()
      if (!isDrawing.current) return
      isDrawing.current = false
      onPointerUp?.(toCanvasPos(e))
    },
    [toCanvasPos, onPointerUp, onLeave]
  )

  return { isDrawing, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerLeave }
}
