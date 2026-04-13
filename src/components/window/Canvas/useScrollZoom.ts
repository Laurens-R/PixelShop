import { useEffect, useLayoutEffect } from 'react'

/**
 * Manages zoom-to-cursor (Ctrl+scroll) and scroll-position save/restore.
 *
 * @param isActive       Whether this canvas tab is currently visible.
 * @param isActiveRef    Ref mirror of isActive (readable inside async/event handlers).
 * @param viewportRef    Ref to the scrollable viewport div.
 * @param zoomRef        Ref that always holds the current zoom level.
 * @param pendingScrollRef  Written by the wheel handler; consumed by the layout effect.
 * @param scrollPosRef   Persists scroll position across tab switches.
 * @param zoom           Current zoom level (used as layout-effect dependency).
 * @param onZoom         Called with the new zoom value when Ctrl+scroll fires.
 */
export function useScrollZoom(
  isActive: boolean,
  isActiveRef: React.RefObject<boolean>,
  viewportRef: React.RefObject<HTMLDivElement | null>,
  zoomRef: React.RefObject<number>,
  pendingScrollRef: React.MutableRefObject<{ scrollLeft: number; scrollTop: number } | null>,
  scrollPosRef: React.MutableRefObject<{ left: number; top: number }>,
  zoom: number,
  onZoom: (zoom: number) => void,
): void {
  // Ctrl+scroll → zoom to cursor position
  useEffect(() => {
    if (!isActive) return
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const oldZoom = zoomRef.current!
      // Smooth on trackpad (pixel deltaMode), fixed step on mouse wheel
      const factor = e.deltaMode === 0
        ? Math.pow(0.998, e.deltaY)
        : e.deltaY < 0 ? 1.25 : 0.8
      const newZoom = parseFloat(
        Math.min(32, Math.max(0.05, oldZoom * factor)).toFixed(4)
      )
      pendingScrollRef.current = {
        scrollLeft: (vp.scrollLeft + cursorX) * (newZoom / oldZoom) - cursorX,
        scrollTop:  (vp.scrollTop  + cursorY) * (newZoom / oldZoom) - cursorY,
      }
      onZoom(newZoom)
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [isActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // Continuously track scroll position — only while active so browser-triggered
  // scroll resets (on visibility change) don't overwrite the saved position.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onScroll = (): void => {
      if (isActiveRef.current) {
        scrollPosRef.current = { left: vp.scrollLeft, top: vp.scrollTop }
      }
    }
    vp.addEventListener('scroll', onScroll, { passive: true })
    return () => vp.removeEventListener('scroll', onScroll)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore scroll before paint when becoming active (layout change may have reset it)
  useLayoutEffect(() => {
    if (!isActive) return
    const vp = viewportRef.current
    if (vp) { vp.scrollLeft = scrollPosRef.current.left; vp.scrollTop = scrollPosRef.current.top }
  }, [isActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply pending zoom-scroll after the zoom re-render, before paint
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current
    if (!pending) return
    pendingScrollRef.current = null
    const vp = viewportRef.current
    if (!vp) return
    vp.scrollLeft = pending.scrollLeft
    vp.scrollTop  = pending.scrollTop
  }, [zoom]) // eslint-disable-line react-hooks/exhaustive-deps
}
