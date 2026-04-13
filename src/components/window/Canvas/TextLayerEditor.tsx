import { useEffect, useRef } from 'react'
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

  // Focus as soon as the textarea mounts
  useEffect(() => {
    if (editingLayerId && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [editingLayerId])

  // Close when the user clicks OUTSIDE the textarea.
  // We add the listener after the current event loop tick so that the creation
  // click (which triggered the editor) is never caught here.
  useEffect(() => {
    if (!editingLayerId) return
    const close = (e: PointerEvent): void => {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        onCloseRef.current()
      }
    }
    document.addEventListener('pointerdown', close, { capture: true })
    return () => document.removeEventListener('pointerdown', close, { capture: true })
  }, [editingLayerId])

  if (!editingLayerId) return null

  const ls = layers.find(
    (l): l is TextLayerState => 'type' in l && l.type === 'text' && l.id === editingLayerId
  )
  if (!ls) return null

  // Compute fixed screen position of the text origin.
  // Subtract the textarea's border (2px) + padding (4px left, 2px top) so the
  // first character rendered inside the box aligns with ls.x / ls.y on the canvas.
  const BORDER = 2    // matches .textEditor border-width
  const PAD_X  = 4    // matches .textEditor padding-left / padding-right
  const PAD_Y  = 2    // matches .textEditor padding-top / padding-bottom
  const wrapperRect = canvasWrapperRef.current?.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const cssZoom = zoom / dpr
  const screenX = (wrapperRect?.left ?? 0) + ls.x * cssZoom - BORDER - PAD_X
  const screenY = (wrapperRect?.top  ?? 0) + ls.y * cssZoom - BORDER - PAD_Y
  const fontSizePx = ls.fontSize * cssZoom

  const fontStyle = [
    ls.italic ? 'italic' : '',
    ls.bold   ? 'bold'   : '',
    `${fontSizePx}px`,
    `"${ls.fontFamily}", sans-serif`,
  ].filter(Boolean).join(' ')

  const textarea = (
    <textarea
      ref={textareaRef}
      key={editingLayerId}
      className={styles.textEditor}
      style={{
        position:       'fixed',
        left:           screenX,
        top:            screenY,
        font:           fontStyle,
        color:          `rgb(${ls.color.r},${ls.color.g},${ls.color.b})`,
        textDecoration: ls.underline ? 'underline' : 'none',
        minWidth:       `${Math.max(80, fontSizePx * 4)}px`,
        minHeight:      `${fontSizePx + 8}px`,
        lineHeight:     '1.2',
      }}
      rows={1}
      value={ls.text}
      onChange={(e) => onCommit({ ...ls, text: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCloseRef.current()
        e.stopPropagation()  // don't let shortcuts reach the app while typing
      }}
      onPointerDown={(e) => e.stopPropagation()}  // don't create a new text layer
    />
  )

  return ReactDOM.createPortal(textarea, document.body)
}
