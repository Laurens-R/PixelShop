import { useEffect } from 'react'
import { selectionStore } from '@/store/selectionStore'
import { cropStore } from '@/store/cropStore'

/**
 * Drives the marching-ants / crop-overlay RAF animation loop.
 * Renders selection borders and crop rectangles onto `overlayRef` every frame.
 * Only active when `isActive` is true.
 */
export function useMarchingAnts(
  isActive: boolean,
  overlayRef: React.RefObject<HTMLCanvasElement | null>,
): void {
  useEffect(() => {
    if (!isActive) return
    let rafId: number
    let dashOffset = 0

    const tick = (): void => {
      rafId = requestAnimationFrame(tick)
      const overlay = overlayRef.current
      if (!overlay) return
      const ctx2d = overlay.getContext('2d')
      if (!ctx2d) return

      ctx2d.clearRect(0, 0, overlay.width, overlay.height)

      const { mask, pending, borderSegments } = selectionStore
      const hasCrop = !!(cropStore.pendingRect || cropStore.rect)
      if (!mask && !pending && !hasCrop) return

      // ── Selection marching ants ────────────────────────────────────────────
      if (borderSegments && borderSegments.length > 0) {
        dashOffset = (dashOffset + 0.25) % 8
        ctx2d.lineWidth = 1
        ctx2d.setLineDash([4, 4])
        for (const [color, extra] of [['#000000', 0], ['#ffffff', 4]] as const) {
          ctx2d.strokeStyle = color
          ctx2d.lineDashOffset = dashOffset + extra
          ctx2d.beginPath()
          for (let i = 0; i < borderSegments.length; i += 4) {
            ctx2d.moveTo(borderSegments[i],     borderSegments[i + 1])
            ctx2d.lineTo(borderSegments[i + 2], borderSegments[i + 3])
          }
          ctx2d.stroke()
        }
      }

      // ── Pending drag preview ───────────────────────────────────────────────
      if (pending) {
        ctx2d.strokeStyle = '#00aaff'
        ctx2d.lineWidth   = 1
        ctx2d.setLineDash([4, 2])
        ctx2d.lineDashOffset = 0
        ctx2d.beginPath()
        if (pending.type === 'rect') {
          const { x1, y1, x2, y2 } = pending
          ctx2d.rect(
            Math.min(x1, x2), Math.min(y1, y2),
            Math.abs(x2 - x1), Math.abs(y2 - y1)
          )
        } else {
          const pts = pending.points
          if (pts.length > 1) {
            ctx2d.moveTo(pts[0].x, pts[0].y)
            for (let i = 1; i < pts.length; i++) ctx2d.lineTo(pts[i].x, pts[i].y)
          }
        }
        ctx2d.stroke()
      }

      // ── Crop overlay ───────────────────────────────────────────────────────
      const cp = cropStore.pendingRect
      const cr = cropStore.rect
      if (cp) {
        ctx2d.strokeStyle = '#ff9900'
        ctx2d.lineWidth   = 1
        ctx2d.setLineDash([4, 2])
        ctx2d.lineDashOffset = 0
        ctx2d.strokeRect(
          Math.min(cp.x1, cp.x2), Math.min(cp.y1, cp.y2),
          Math.abs(cp.x2 - cp.x1), Math.abs(cp.y2 - cp.y1)
        )
      } else if (cr) {
        dashOffset = (dashOffset + 0.25) % 8
        ctx2d.lineWidth = 1
        ctx2d.setLineDash([4, 4])
        for (const [color, extra] of [['#000000', 0], ['#ff9900', 4]] as const) {
          ctx2d.strokeStyle = color
          ctx2d.lineDashOffset = dashOffset + extra
          ctx2d.strokeRect(cr.x, cr.y, cr.w, cr.h)
        }
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])
}
