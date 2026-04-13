import { useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import type { LayerState, TextLayerState } from '@/types'
import styles from './Canvas.module.scss'

export interface TextLayerEditorProps {
  editingLayerId: string | null
  layers: LayerState[]
  zoom: number
  canvasWrapperRef: React.RefObject<HTMLDivElement | null>
  onCommit: (ls: TextLayerState) => void
  onClose: () => void
}

// Handle positions: which edges each handle controls
// dx/dy: -1 = left/top edge, 0 = none, 1 = right/bottom edge
const HANDLES = [
  { id: 'nw', dx: -1, dy: -1, cursor: 'nw-resize' },
  { id: 'n',  dx:  0, dy: -1, cursor: 'n-resize'  },
  { id: 'ne', dx:  1, dy: -1, cursor: 'ne-resize'  },
  { id: 'e',  dx:  1, dy:  0, cursor: 'e-resize'   },
  { id: 'se', dx:  1, dy:  1, cursor: 'se-resize'  },
  { id: 's',  dx:  0, dy:  1, cursor: 's-resize'   },
  { id: 'sw', dx: -1, dy:  1, cursor: 'sw-resize'  },
  { id: 'w',  dx: -1, dy:  0, cursor: 'w-resize'   },
] as const

const MIN_BOX = 40 // minimum box size in canvas pixels

export function TextLayerEditor({
  editingLayerId,
  layers,
  zoom,
  canvasWrapperRef,
  onCommit,
  onClose,
}: TextLayerEditorProps): React.JSX.Element | null {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const onCloseRef  = useRef(onClose)
  onCloseRef.current = onClose

  // Focus and measure as soon as the textarea mounts
  useEffect(() => {
    const el = textareaRef.current
    if (editingLayerId && el) {
      el.focus()
    }
  }, [editingLayerId])

  // Close when the user clicks OUTSIDE the editor box, but NOT inside the tool options bar.
  useEffect(() => {
    if (!editingLayerId) return
    const close = (e: PointerEvent): void => {
      const target = e.target as Element
      if (target.closest?.('[data-text-editor-root]')) return
      if (target.closest?.('[data-text-editor-safe]')) return
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', close, { capture: true })
    return () => document.removeEventListener('pointerdown', close, { capture: true })
  }, [editingLayerId])

  // ── Resize handle drag logic ───────────────────────────────────────────────
  const resizeDragRef = useRef<{
    handle: typeof HANDLES[number]
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    startBoxW: number
    startBoxH: number
    ls: TextLayerState
  } | null>(null)

  const onHandlePointerDown = useCallback((
    e: React.PointerEvent,
    handle: typeof HANDLES[number],
    ls: TextLayerState,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const dpr = window.devicePixelRatio || 1
    const cssZoom = zoom / dpr
    resizeDragRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: ls.x,
      startY: ls.y,
      startBoxW: ls.boxWidth  > 0 ? ls.boxWidth  : MIN_BOX,
      startBoxH: ls.boxHeight > 0 ? ls.boxHeight : MIN_BOX,
      ls,
    }
    // Capture zoom at drag-start so it's stable
    ;(resizeDragRef.current as { cssZoom?: number }).cssZoom = cssZoom
  }, [zoom])

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = resizeDragRef.current
    if (!drag) return
    const cssZoom = (drag as { cssZoom?: number }).cssZoom ?? 1
    const ddx = (e.clientX - drag.startClientX) / cssZoom
    const ddy = (e.clientY - drag.startClientY) / cssZoom
    const { handle, startX, startY, startBoxW, startBoxH, ls } = drag

    let newX = startX
    let newY = startY
    let newW = startBoxW
    let newH = startBoxH

    if (handle.dx === 1) {
      newW = Math.max(MIN_BOX, Math.round(startBoxW + ddx))
    } else if (handle.dx === -1) {
      const delta = Math.round(ddx)
      newW = Math.max(MIN_BOX, startBoxW - delta)
      newX = startX + (startBoxW - newW)
    }
    if (handle.dy === 1) {
      newH = Math.max(MIN_BOX, Math.round(startBoxH + ddy))
    } else if (handle.dy === -1) {
      const delta = Math.round(ddy)
      newH = Math.max(MIN_BOX, startBoxH - delta)
      newY = startY + (startBoxH - newH)
    }

    onCommit({ ...ls, x: newX, y: newY, boxWidth: newW, boxHeight: newH })
  }, [onCommit])

  const onHandlePointerUp = useCallback(() => {
    resizeDragRef.current = null
  }, [])

  if (!editingLayerId) return null

  const ls = layers.find(
    (l): l is TextLayerState => 'type' in l && l.type === 'text' && l.id === editingLayerId
  )
  if (!ls) return null

  const dpr = window.devicePixelRatio || 1
  const cssZoom = zoom / dpr
  const wrapperRect = canvasWrapperRef.current?.getBoundingClientRect()
  const fontSizePx = ls.fontSize * cssZoom

  // Box dimensions in screen pixels
  const BORDER = 2
  const boxWpx = (ls.boxWidth  > 0 ? ls.boxWidth  : Math.max(80, fontSizePx * 6)) * cssZoom
  const boxHpx = (ls.boxHeight > 0 ? ls.boxHeight : Math.max(fontSizePx + 8, fontSizePx * 1.5)) * cssZoom

  const screenX = (wrapperRect?.left ?? 0) + ls.x * cssZoom - BORDER
  const screenY = (wrapperRect?.top  ?? 0) + ls.y * cssZoom - BORDER

  const fontStyle = [
    ls.italic ? 'italic' : '',
    ls.bold   ? 'bold'   : '',
    `${fontSizePx}px`,
    `"${ls.fontFamily}", sans-serif`,
  ].filter(Boolean).join(' ')

  const editor = (
    <div
      data-text-editor-root
      className={styles.textEditorRoot}
      style={{
        position: 'fixed',
        left:     screenX,
        top:      screenY,
        width:    boxWpx + BORDER * 2,
        height:   boxHpx + BORDER * 2,
      }}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
    >
      {/* Textarea filling the box */}
      <textarea
        ref={textareaRef}
        key={editingLayerId}
        className={styles.textEditor}
        style={{
          font:           fontStyle,
          color:          `rgb(${ls.color.r},${ls.color.g},${ls.color.b})`,
          textDecoration: ls.underline ? 'underline' : 'none',
          textAlign:      ls.align === 'justify' ? 'justify' : ls.align,
          lineHeight:     '1.2',
          width:          '100%',
          height:         '100%',
          overflow:       ls.boxHeight > 0 ? 'hidden' : 'visible',
        }}
        value={ls.text}
        onChange={(e) => onCommit({ ...ls, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCloseRef.current()
          e.stopPropagation()
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {/* 8 resize handles */}
      {HANDLES.map((h) => (
        <div
          key={h.id}
          className={`${styles.resizeHandle} ${styles[`handle-${h.id}`]}`}
          style={{ cursor: h.cursor }}
          onPointerDown={(e) => onHandlePointerDown(e, h, ls)}
        />
      ))}
    </div>
  )

  return ReactDOM.createPortal(editor, document.body)
}
