import React, { useEffect, useRef, useState } from 'react'
import type { LayerState, BlendMode } from '@/types'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import styles from './LayerPanel.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal',      label: 'Normal' },
  { value: 'multiply',    label: 'Multiply' },
  { value: 'screen',      label: 'Screen' },
  { value: 'overlay',     label: 'Overlay' },
  { value: 'soft-light',  label: 'Soft Light' },
  { value: 'hard-light',  label: 'Hard Light' },
  { value: 'darken',      label: 'Darken' },
  { value: 'lighten',     label: 'Lighten' },
  { value: 'difference',  label: 'Difference' },
  { value: 'exclusion',   label: 'Exclusion' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn',  label: 'Color Burn' },
]

// ─── Icons ────────────────────────────────────────────────────────────────────

const EyeIcon = ({ visible }: { visible: boolean }): React.JSX.Element =>
  visible ? (
    <svg viewBox="0 0 14 14" fill="currentColor" width="12" height="12">
      <path d="M7 2C4 2 1.5 5 1.5 7S4 12 7 12s5.5-3 5.5-5S10 2 7 2zm0 8a3 3 0 110-6 3 3 0 010 6z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" width="12" height="12">
      <path d="M2 2l10 10M5.5 4.2A5.5 5.5 0 017 4c3 0 5 2.5 5.5 3-.4.7-1.3 1.8-2.5 2.5M3 5.5C2 6.2 1.5 6.8 1.5 7c.5.5 2.5 3 5.5 3 .6 0 1.2-.1 1.7-.3" strokeLinecap="round" />
    </svg>
  )

const LockIcon = ({ locked }: { locked: boolean }): React.JSX.Element =>
  locked ? (
    <svg viewBox="0 0 12 14" fill="currentColor" width="10" height="12">
      <rect x="2" y="6" width="8" height="7" rx="1" />
      <path d="M4 6V4.5a2 2 0 114 0V6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ) : (
    <svg viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.3" width="10" height="12">
      <rect x="2" y="6" width="8" height="7" rx="1" />
      <path d="M4 6V4.5a2 2 0 114 0V6" strokeLinecap="round" />
    </svg>
  )

const AddLayerIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" width="12" height="12">
    <rect x="2" y="4" width="8" height="8" rx="1" />
    <path d="M5 2h6a1 1 0 011 1v6" strokeLinecap="round" />
    <path d="M6 8h4M8 6v4" strokeLinecap="round" />
  </svg>
)

const DeleteLayerIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" width="12" height="12">
    <path d="M3 4h8M5 4V3h4v1M5 4v7h4V4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

interface LayerPanelProps {
  layers: LayerState[]
  activeLayerId?: string
  onActiveLayerChange: (id: string) => void
  onLayerAdd: () => void
  onLayerDelete: (id: string) => void
  onLayerToggleVisibility: (id: string) => void
  onLayerToggleLock: (id: string) => void
  onLayerOpacityChange: (id: string, opacity: number) => void
  onLayerBlendChange: (id: string, blendMode: BlendMode) => void
  onLayerRename: (id: string, name: string) => void
  onLayersReorder: (layers: LayerState[]) => void
  onMergeSelected: (ids: string[]) => void
  onMergeVisible: () => void
  onMergeDown: () => void
  onFlattenImage: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LayerPanel({
  layers,
  activeLayerId,
  onActiveLayerChange,
  onLayerAdd,
  onLayerDelete,
  onLayerToggleVisibility,
  onLayerToggleLock,
  onLayerOpacityChange,
  onLayerBlendChange,
  onLayerRename,
  onLayersReorder,
  onMergeSelected,
  onMergeVisible,
  onMergeDown,
  onFlattenImage,
}: LayerPanelProps): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const dragSrcIdx = useRef<number | null>(null)

  // Close context menu when pressing Escape
  useEffect(() => {
    if (!contextMenu) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contextMenu])

  const handleLayerClick = (layer: LayerState, e: React.MouseEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedIds)
      if (next.has(layer.id)) next.delete(layer.id)
      else next.add(layer.id)
      setSelectedIds(next)
    } else {
      onActiveLayerChange(layer.id)
      setSelectedIds(new Set())
    }
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const closeContextMenu = (): void => setContextMenu(null)

  const execMergeSelected = (): void => {
    closeContextMenu()
    // Always include the active layer so active + 1 Ctrl-click = 2 layers
    const effective = new Set(selectedIds)
    if (activeLayerId) effective.add(activeLayerId)
    onMergeSelected([...effective])
    setSelectedIds(new Set())
  }

  const execMergeVisible = (): void => {
    closeContextMenu()
    onMergeVisible()
    setSelectedIds(new Set())
  }

  const execMergeDown = (): void => {
    closeContextMenu()
    onMergeDown()
    setSelectedIds(new Set())
  }

  const execFlattenImage = (): void => {
    closeContextMenu()
    onFlattenImage()
    setSelectedIds(new Set())
  }

  const activeLayer = layers.find((l) => l.id === activeLayerId)
  const canDelete = layers.length > 1
  const displayLayers = [...layers].reverse()

  const opacityValue = activeLayer ? Math.round(activeLayer.opacity * 100) : 100
  const blendValue: BlendMode = activeLayer?.blendMode ?? 'normal'

  const startEdit = (layer: LayerState, e: React.MouseEvent): void => {
    e.stopPropagation()
    setEditingId(layer.id)
    setEditingName(layer.name)
  }

  const commitEdit = (): void => {
    if (editingId && editingName.trim()) onLayerRename(editingId, editingName.trim())
    setEditingId(null)
  }

  const handleEditKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commitEdit()
    else if (e.key === 'Escape') setEditingId(null)
  }

  const handleDragStart = (displayIdx: number, e: React.DragEvent): void => {
    dragSrcIdx.current = displayIdx
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (displayIdx: number, e: React.DragEvent): void => {
    e.preventDefault()
    const src = dragSrcIdx.current
    if (src === null || src === displayIdx) return
    const reordered = [...displayLayers]
    const [moved] = reordered.splice(src, 1)
    reordered.splice(displayIdx, 0, moved)
    onLayersReorder([...reordered].reverse())
    dragSrcIdx.current = null
  }

  return (
    <div className={styles.panel}>
      {/* ── Blend mode + Opacity ──────────────────────────────────────── */}
      <div className={styles.blendRow}>
        <select
          className={styles.blendSelect}
          value={blendValue}
          disabled={!activeLayer}
          onChange={(e) => activeLayer && onLayerBlendChange(activeLayer.id, e.target.value as BlendMode)}
        >
          {BLEND_MODES.map((bm) => (
            <option key={bm.value} value={bm.value}>{bm.label}</option>
          ))}
        </select>
        <label className={styles.numLabel}>Opacity:</label>
        <SliderInput
          key={activeLayerId}
          value={opacityValue}
          min={0}
          max={100}
          step={1}
          inputWidth={34}
          suffix="%"
          disabled={!activeLayer}
          onChange={(n) => activeLayer && onLayerOpacityChange(activeLayer.id, n / 100)}
        />
      </div>

      {/* ── Lock row ─────────────────────────────────────────────────── */}
      <div className={styles.lockRow}>
        <span className={styles.lockLabel}>Lock:</span>
        <button
          className={`${styles.lockBtn} ${activeLayer?.locked ? styles.lockBtnActive : ''}`}
          title={activeLayer?.locked ? 'Unlock layer' : 'Lock layer'}
          disabled={!activeLayer}
          onClick={() => activeLayer && onLayerToggleLock(activeLayer.id)}
        >
          <LockIcon locked={activeLayer?.locked ?? false} />
        </button>
      </div>

      {/* ── Layer list ────────────────────────────────────────────────── */}
      <ul className={styles.list} role="listbox" aria-label="Layers" onContextMenu={handleContextMenu}>
        {displayLayers.map((layer, displayIdx) => {
          const isActive = layer.id === activeLayerId
          const isSelected = selectedIds.has(layer.id)
          return (
            <li
              key={layer.id}
              className={[
                styles.item,
                isActive    ? styles.itemActive   : '',
                isSelected && !isActive ? styles.itemSelected : '',
              ].join(' ')}
              role="option"
              aria-selected={isActive}
              draggable
              onDragStart={(e) => handleDragStart(displayIdx, e)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(displayIdx, e)}
              onClick={(e) => handleLayerClick(layer, e)}
            >
              <button
                className={styles.eyeBtn}
                onClick={(e) => { e.stopPropagation(); onLayerToggleVisibility(layer.id) }}
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                <EyeIcon visible={layer.visible} />
              </button>

              <div className={styles.thumb} aria-hidden="true" />

              {editingId === layer.id ? (
                <input
                  autoFocus
                  className={styles.nameInput}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={handleEditKey}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className={styles.name}
                  onDoubleClick={(e) => startEdit(layer, e)}
                  title="Double-click to rename"
                >
                  {layer.name}
                </span>
              )}

              {layer.locked && (
                <span className={styles.lockIcon}><LockIcon locked /></span>
              )}
            </li>
          )
        })}
      </ul>

      {/* ── Footer toolbar ────────────────────────────────────────────── */}
      <div className={styles.footer}>
        <button className={styles.footerBtn} onClick={onLayerAdd} aria-label="New layer" title="New layer">
          <AddLayerIcon />
        </button>
        <button
          className={styles.footerBtn}
          onClick={() => activeLayerId && onLayerDelete(activeLayerId)}
          aria-label="Delete layer"
          title="Delete layer"
          disabled={!canDelete}
        >
          <DeleteLayerIcon />
        </button>
      </div>

      {/* ── Context menu ──────────────────────────────────────────────── */}
      {contextMenu && (
        <>
          <div className={styles.menuBackdrop} onMouseDown={closeContextMenu} />
          <div className={styles.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              className={styles.menuItem}
              disabled={new Set([...selectedIds, ...(activeLayerId ? [activeLayerId] : [])]).size < 2}
              onMouseDown={execMergeSelected}
            >
              Merge Selected
            </button>
            <button
              className={styles.menuItem}
              disabled={layers.filter((l) => l.visible).length < 2}
              onMouseDown={execMergeVisible}
            >
              Merge Visible
            </button>
            <button
              className={styles.menuItem}
              disabled={!activeLayerId || layers.findIndex((l) => l.id === activeLayerId) === 0}
              onMouseDown={execMergeDown}
            >
              Merge Down
            </button>
            <button
              className={styles.menuItem}
              disabled={layers.length < 2}
              onMouseDown={execFlattenImage}
            >
              Flatten Image
            </button>
          </div>
        </>
      )}
    </div>
  )
}
