import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { LayerState, BlendMode, MaskLayerState, AdjustmentLayerState, GroupLayerState } from '@/types'
import { isGroupLayer } from '@/types'
import { useAppContext } from '@/store/AppContext'
import { buildRootLayerIds, getParentGroup, isDescendantOf, reorderRootLayers } from '@/utils/layerTree'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import styles from './LayerPanel.module.scss'

// ─── Constants ────────────────────────────────────────────────────────────────

const BLEND_MODES_BASE: { value: BlendMode; label: string }[] = [
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

const BLEND_MODES_GROUP: { value: BlendMode; label: string }[] = [
  { value: 'pass-through', label: 'Pass Through' },
  ...BLEND_MODES_BASE,
]

// ─── Drop target ──────────────────────────────────────────────────────────────

type DropTarget =
  | { kind: 'before'; layerId: string }
  | { kind: 'after';  layerId: string }
  | { kind: 'into';   groupId: string }

// ─── Tree row ─────────────────────────────────────────────────────────────────

interface TreeRow {
  layer: LayerState
  depth: number
}

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

const AddGroupIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" width="12" height="12">
    <path d="M1 4h12v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" />
    <path d="M1 4V3a1 1 0 011-1h3l1.5 2H1z" />
    <path d="M7 8h3M8.5 6.5v3" strokeLinecap="round" />
  </svg>
)

const MaskIcon = ({ active }: { active: boolean }): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" width="12" height="12">
    <circle cx="7" cy="7" r="5" />
    {active
      ? <path d="M7 2v10M2 7h10" strokeLinecap="round" />
      : <path d="M2 7h10" strokeLinecap="round" />
    }
  </svg>
)

const AdjustmentIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" width="12" height="12">
    <line x1="2" y1="4" x2="12" y2="4" />
    <circle cx="5" cy="4" r="1.5" fill="currentColor" stroke="none" />
    <line x1="2" y1="7" x2="12" y2="7" />
    <circle cx="9" cy="7" r="1.5" fill="currentColor" stroke="none" />
    <line x1="2" y1="10" x2="12" y2="10" />
    <circle cx="6" cy="10" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)

const DeleteLayerIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" width="12" height="12">
    <path d="M3 4h8M5 4V3h4v1M5 4v7h4V4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const FolderIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" width="13" height="13">
    <path d="M1 4h12v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" />
    <path d="M1 4V3a1 1 0 011-1h3l1.5 2H1z" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

interface LayerPanelProps {
  onMergeSelected:     (ids: string[]) => void
  onMergeVisible:      () => void
  onMergeDown:         () => void
  onFlattenImage:      () => void
  onRasterizeLayer:    (layerId: string) => void
  onOpenAdjustmentPanel?: (layerId: string) => void
  onMergeGroup:        (groupId: string) => void
  onGroupSelected:     (layerIds: string[]) => void
  onUngroup:           (groupId: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LayerPanel({
  onMergeSelected,
  onMergeVisible,
  onMergeDown,
  onFlattenImage,
  onRasterizeLayer,
  onOpenAdjustmentPanel,
  onMergeGroup,
  onGroupSelected,
  onUngroup,
}: LayerPanelProps): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const layers = state.layers
  const activeLayerId = state.activeLayerId ?? undefined

  const onActiveLayerChange = (id: string): void => { dispatch({ type: 'SET_ACTIVE_LAYER', payload: id }) }
  const onLayerAdd = (): void => {
    const id = `layer-${Date.now()}`
    dispatch({
      type: 'ADD_LAYER',
      payload: { id, name: `Layer ${layers.length + 1}`, visible: true, opacity: 1, locked: false, blendMode: 'normal' },
    })
  }
  const onLayerDelete = (id: string): void => { dispatch({ type: 'REMOVE_LAYER', payload: id }) }
  const onLayerToggleVisibility = (id: string): void => { dispatch({ type: 'TOGGLE_LAYER_VISIBILITY', payload: id }) }
  const onLayerToggleLock = (id: string): void => { dispatch({ type: 'TOGGLE_LAYER_LOCK', payload: id }) }
  const onLayerOpacityChange = (id: string, opacity: number): void => { dispatch({ type: 'SET_LAYER_OPACITY', payload: { id, opacity } }) }
  const onLayerBlendChange = (id: string, blendMode: BlendMode): void => { dispatch({ type: 'SET_LAYER_BLEND', payload: { id, blendMode } }) }
  const onLayerRename = (id: string, name: string): void => { dispatch({ type: 'RENAME_LAYER', payload: { id, name } }) }
  const onAddMaskLayer = (parentId: string): void => {
    const hasMask = layers.some(l => 'type' in l && l.type === 'mask' && (l as { parentId: string }).parentId === parentId)
    if (hasMask) return
    dispatch({ type: 'ADD_MASK_LAYER', payload: { id: `mask-${Date.now()}`, name: 'Layer Mask', visible: true, type: 'mask', parentId } })
  }

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const selectedIds = new Set(state.selectedLayerIds)
  const setSelectedIds = (next: Set<string>): void => { dispatch({ type: 'SET_SELECTED_LAYERS', payload: [...next] }) }
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flipX: boolean } | null>(null)
  const dragSrcLayerIdRef = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contextMenu])

  // ── Tree rows ────────────────────────────────────────────────────────────────

  const treeRows: TreeRow[] = useMemo(() => {
    const result: TreeRow[] = []
    const layersById = new Map(layers.map(l => [l.id, l]))
    const rootIds = buildRootLayerIds(layers)

    function walk(ids: readonly string[], depth: number, parentCollapsed: boolean): void {
      if (parentCollapsed) return
      for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i]
        const layer = layersById.get(id)
        if (!layer) continue
        // Skip per-layer mask/adjustment: yielded after their pixel parent
        if ('type' in layer && (layer.type === 'mask' || layer.type === 'adjustment')) {
          const parent = layersById.get((layer as MaskLayerState | AdjustmentLayerState).parentId)
          if (parent && !isGroupLayer(parent)) continue
        }
        result.push({ layer, depth })
        if (isGroupLayer(layer)) {
          walk(layer.childIds, depth + 1, layer.collapsed)
        } else if (!('type' in layer) || (layer.type !== 'mask' && layer.type !== 'adjustment')) {
          // Pixel/text/shape: append attached children
          for (const child of layers) {
            if (
              'type' in child &&
              (child.type === 'mask' || child.type === 'adjustment') &&
              (child as MaskLayerState | AdjustmentLayerState).parentId === layer.id
            ) {
              result.push({ layer: child, depth: depth + 1 })
            }
          }
        }
      }
    }

    walk(rootIds, 0, false)
    return result
  }, [layers])

  // Determine which row to highlight as "active" — if the active layer is hidden
  // inside a collapsed group, highlight the collapsed group row instead.
  const displayActiveId = useMemo((): string | null => {
    if (!activeLayerId) return null
    if (treeRows.some(r => r.layer.id === activeLayerId)) return activeLayerId
    // Active layer is inside a collapsed group — walk up the parent chain
    let current = activeLayerId
    for (;;) {
      const parent = getParentGroup(layers, current)
      if (!parent) return current
      if (treeRows.some(r => r.layer.id === parent.id)) return parent.id
      current = parent.id
    }
  }, [activeLayerId, layers, treeRows])

  // ── Interaction ──────────────────────────────────────────────────────────────

  const handleLayerClick = (layer: LayerState, e: React.MouseEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedIds)
      if (next.has(layer.id)) next.delete(layer.id)
      else next.add(layer.id)
      setSelectedIds(next)
    } else {
      onActiveLayerChange(layer.id)
      setSelectedIds(new Set())
      if ('type' in layer && layer.type === 'adjustment') {
        onOpenAdjustmentPanel?.(layer.id)
      }
    }
  }

  const MENU_WIDTH = 180
  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const flipX = e.clientX + MENU_WIDTH > window.innerWidth
    setContextMenu({ x: e.clientX, y: e.clientY, flipX })
  }

  const closeContextMenu = (): void => setContextMenu(null)

  const execMergeSelected = (): void => {
    closeContextMenu()
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

  // ── Layer panel header state ──────────────────────────────────────────────────

  const activeLayer = layers.find((l) => l.id === activeLayerId)
  const canDelete = layers.length > 1
  const isChildLayer = (l: LayerState): boolean =>
    'type' in l && (l.type === 'mask' || l.type === 'adjustment')

  const isActiveGroup = activeLayer !== undefined && isGroupLayer(activeLayer)

  const canRasterize = !!activeLayerId && !!activeLayer && !isChildLayer(activeLayer) && !isActiveGroup && (
    ('type' in activeLayer && (activeLayer.type === 'text' || activeLayer.type === 'shape')) ||
    (!('type' in activeLayer) && layers.some(
      l => 'type' in l && l.type === 'adjustment' && (l as { parentId: string }).parentId === activeLayerId
    ))
  )

  const isChildActive = activeLayer !== undefined && 'type' in activeLayer &&
    (activeLayer.type === 'mask' || activeLayer.type === 'adjustment')

  const opacityValue = (!isChildActive && activeLayer) ? Math.round((activeLayer as { opacity: number }).opacity * 100) : 100
  const blendValue: BlendMode = (!isChildActive && activeLayer) ? (activeLayer as { blendMode: BlendMode }).blendMode : 'normal'

  const activeBlendModes = isActiveGroup ? BLEND_MODES_GROUP : BLEND_MODES_BASE

  const canAddMask = activeLayerId && !isChildActive && !isActiveGroup &&
    !layers.some(l => 'type' in l && l.type === 'mask' && (l as { parentId: string }).parentId === activeLayerId)

  // ── Editing ──────────────────────────────────────────────────────────────────

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

  // ── Footer group button ───────────────────────────────────────────────────────

  const onAddGroup = (): void => {
    const effective = [...new Set([...selectedIds, ...(activeLayerId ? [activeLayerId] : [])])]
    if (effective.length >= 2) {
      onGroupSelected(effective)
    } else {
      const id = `group-${Date.now()}`
      dispatch({ type: 'ADD_LAYER_GROUP', payload: { id, name: 'Group', aboveLayerId: activeLayerId ?? undefined } })
    }
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────────

  const handleDragStart = (layerId: string, e: React.DragEvent): void => {
    dragSrcLayerIdRef.current = layerId
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = (): void => {
    dragSrcLayerIdRef.current = null
    setDropTarget(null)
  }

  const handleDragOver = (e: React.DragEvent, layerId: string, isGroup: boolean): void => {
    e.preventDefault()
    const srcId = dragSrcLayerIdRef.current
    if (!srcId) return
    if (layerId === srcId) { e.dataTransfer.dropEffect = 'none'; return }
    if (isDescendantOf(layers, layerId, srcId)) { e.dataTransfer.dropEffect = 'none'; return }
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const relY = (e.clientY - rect.top) / rect.height
    if (isGroup && relY >= 0.25 && relY <= 0.75) {
      setDropTarget({ kind: 'into', groupId: layerId })
    } else if (relY < 0.5) {
      setDropTarget({ kind: 'before', layerId })
    } else {
      setDropTarget({ kind: 'after', layerId })
    }
  }

  const handleDragLeave = (e: React.DragEvent): void => {
    // Only clear if leaving the list entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTarget(null)
    }
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const srcId = dragSrcLayerIdRef.current
    if (!srcId || !dropTarget) { dragSrcLayerIdRef.current = null; setDropTarget(null); return }
    dragSrcLayerIdRef.current = null
    setDropTarget(null)

    if (dropTarget.kind === 'into') {
      if (srcId === dropTarget.groupId) return
      if (isDescendantOf(layers, dropTarget.groupId, srcId)) return
      dispatch({ type: 'MOVE_LAYER_INTO_GROUP', payload: { layerId: srcId, targetGroupId: dropTarget.groupId, insertIndex: 0 } })
      return
    }

    const targetId = dropTarget.layerId
    if (targetId === srcId) return
    if (isDescendantOf(layers, targetId, srcId)) return

    const targetParent = getParentGroup(layers, targetId)
    const srcParent = getParentGroup(layers, srcId)

    if (targetParent) {
      // Target is inside a group
      const targetIdx = targetParent.childIds.indexOf(targetId)
      const insertIndex = dropTarget.kind === 'before' ? targetIdx : targetIdx + 1
      if (srcParent && srcParent.id === targetParent.id) {
        // Reorder within same group
        dispatch({ type: 'MOVE_LAYER_INTO_GROUP', payload: { layerId: srcId, targetGroupId: targetParent.id, insertIndex } })
      } else {
        // Move into (or between groups) — MOVE_LAYER_INTO_GROUP handles removing from old group
        dispatch({ type: 'MOVE_LAYER_INTO_GROUP', payload: { layerId: srcId, targetGroupId: targetParent.id, insertIndex } })
      }
    } else {
      // Target is at root
      if (srcParent) {
        // Moving from group to root — just remove from group; flat position stays
        dispatch({ type: 'MOVE_LAYER_OUT_OF_GROUP', payload: { layerId: srcId, targetParentGroupId: null, insertIndex: 0 } })
      } else {
        // Both at root — reorder
        const rootDisplayIds = buildRootLayerIds(layers)
          .filter(id => {
            const l = layers.find(x => x.id === id)
            return l !== undefined && !('type' in l && (l.type === 'mask' || l.type === 'adjustment'))
          })
          .reverse() // reverse to get top-first display order
        const targetDisplayIdx = rootDisplayIds.indexOf(targetId)
        const dstDisplayIdx = dropTarget.kind === 'before' ? targetDisplayIdx : targetDisplayIdx + 1
        const newLayers = reorderRootLayers(layers, srcId, dstDisplayIdx)
        dispatch({ type: 'REORDER_LAYERS', payload: newLayers })
      }
    }
  }

  return (
    <div className={styles.panel}>
      {/* ── Blend mode + Opacity ──────────────────────────────────────── */}
      <div className={styles.blendRow}>
        <select
          className={styles.blendSelect}
          value={blendValue}
          disabled={!activeLayer || !!isChildActive}
          onChange={(e) => activeLayer && onLayerBlendChange(activeLayer.id, e.target.value as BlendMode)}
        >
          {activeBlendModes.map((bm) => (
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
          disabled={!activeLayer || !!isChildActive}
          onChange={(n) => activeLayer && onLayerOpacityChange(activeLayer.id, n / 100)}
        />
      </div>

      {/* ── Lock row ─────────────────────────────────────────────────── */}
      {!isChildActive && (
        <div className={styles.lockRow}>
          <span className={styles.lockLabel}>Lock:</span>
          <button
            className={`${styles.lockBtn} ${activeLayer && !isChildActive && (activeLayer as { locked?: boolean }).locked ? styles.lockBtnActive : ''}`}
            title={(activeLayer && !isChildActive && (activeLayer as { locked?: boolean }).locked) ? 'Unlock layer' : 'Lock layer'}
            disabled={!activeLayer || !!isChildActive}
            onClick={() => activeLayer && !isChildActive && onLayerToggleLock(activeLayer.id)}
          >
            <LockIcon locked={(!isChildActive && (activeLayer as unknown as { locked?: boolean })?.locked) ?? false} />
          </button>
        </div>
      )}

      {/* ── Layer list ────────────────────────────────────────────────── */}
      <ul
        className={styles.list}
        role="listbox"
        aria-label="Layers"
        onContextMenu={handleContextMenu}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {treeRows.map(({ layer, depth }) => {
          const isMask = 'type' in layer && layer.type === 'mask'
          const isAdjustment = 'type' in layer && layer.type === 'adjustment'
          const isGroup = isGroupLayer(layer)
          const isChild = isMask || isAdjustment
          const isActive = layer.id === displayActiveId
          const isSelected = selectedIds.has(layer.id)
          const isDropBefore = dropTarget?.kind === 'before' && dropTarget.layerId === layer.id
          const isDropAfter  = dropTarget?.kind === 'after'  && dropTarget.layerId === layer.id
          const isDropInto   = dropTarget?.kind === 'into'   && dropTarget.groupId === layer.id

          return (
            <li
              key={layer.id}
              className={[
                styles.item,
                isChild   ? styles.maskItem    : '',
                isActive    ? styles.itemActive   : '',
                isSelected && !isActive ? styles.itemSelected : '',
                isDropBefore ? styles.dropIndicatorBefore : '',
                isDropAfter  ? styles.dropIndicatorAfter  : '',
                isDropInto   ? styles.dropTargetGroup     : '',
              ].join(' ')}
              style={{ paddingLeft: `${5 + depth * 16}px` }}
              role="option"
              aria-selected={isActive}
              draggable={!isChild}
              onDragStart={(e) => !isChild && handleDragStart(layer.id, e)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => !isChild && handleDragOver(e, layer.id, isGroup)}
              onClick={(e) => handleLayerClick(layer, e)}
            >
              {/* Disclosure triangle for groups; spacer for others */}
              {isGroup ? (
                <button
                  className={styles.disclosureBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch({ type: 'TOGGLE_GROUP_COLLAPSE', payload: layer.id })
                  }}
                  aria-label={(layer as GroupLayerState).collapsed ? 'Expand group' : 'Collapse group'}
                  title={(layer as GroupLayerState).collapsed ? 'Expand group' : 'Collapse group'}
                >
                  {(layer as GroupLayerState).collapsed ? '▶' : '▼'}
                </button>
              ) : (
                !isChild && <div className={styles.disclosureSpacer} />
              )}

              {isChild && <div className={styles.childConnector} />}

              <button
                className={styles.eyeBtn}
                onClick={(e) => { e.stopPropagation(); onLayerToggleVisibility(layer.id) }}
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {isMask
                  ? <MaskIcon active={layer.visible} />
                  : isAdjustment
                    ? <AdjustmentIcon />
                    : <EyeIcon visible={layer.visible} />
                }
              </button>

              {isAdjustment
                ? <div className={styles.adjThumb} aria-hidden="true"><AdjustmentIcon /></div>
                : isGroup
                  ? <div className={styles.groupThumb} aria-hidden="true"><FolderIcon /></div>
                  : <div className={`${styles.thumb} ${isMask ? styles.maskThumb : ''}`} aria-hidden="true" />
              }

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
                  className={isAdjustment ? styles.adjName : styles.name}
                  onDoubleClick={(e) => startEdit(layer, e)}
                  title="Double-click to rename"
                >
                  {layer.name}
                </span>
              )}

              {!isChild && (layer as { locked?: boolean }).locked && (
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
        <button className={styles.footerBtn} onClick={onAddGroup} aria-label="New group" title="New layer group">
          <AddGroupIcon />
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
          <div
            className={styles.contextMenu}
            style={contextMenu.flipX
              ? { right: window.innerWidth - contextMenu.x, top: contextMenu.y }
              : { left: contextMenu.x, top: contextMenu.y }
            }
          >
            <button
              className={styles.menuItem}
              disabled={!canAddMask}
              onMouseDown={() => { closeContextMenu(); if (activeLayerId) onAddMaskLayer(activeLayerId) }}
            >
              Add Layer Mask
            </button>
            <button
              className={styles.menuItem}
              disabled={!canRasterize}
              onMouseDown={() => { closeContextMenu(); if (activeLayerId) onRasterizeLayer(activeLayerId) }}
            >
              Rasterize Layer
            </button>
            <button
              className={styles.menuItem}
              disabled={!canDelete}
              onMouseDown={() => {
                closeContextMenu()
                if (activeLayerId) onLayerDelete(activeLayerId)
              }}
            >
              Delete Layer
            </button>
            <div className={styles.menuDivider} />
            {/* Group operations */}
            {new Set([...selectedIds, ...(activeLayerId ? [activeLayerId] : [])]).size >= 2 && (
              <button
                className={styles.menuItem}
                onMouseDown={() => {
                  closeContextMenu()
                  const effective = [...new Set([...selectedIds, ...(activeLayerId ? [activeLayerId] : [])])]
                  onGroupSelected(effective)
                  setSelectedIds(new Set())
                }}
              >
                New Group from Selection
              </button>
            )}
            {isActiveGroup && (
              <button
                className={styles.menuItem}
                onMouseDown={() => { closeContextMenu(); if (activeLayerId) onUngroup(activeLayerId) }}
              >
                Ungroup
              </button>
            )}
            {isActiveGroup && (
              <button
                className={styles.menuItem}
                onMouseDown={() => { closeContextMenu(); if (activeLayerId) onMergeGroup(activeLayerId) }}
              >
                Merge Group
              </button>
            )}
            {(new Set([...selectedIds, ...(activeLayerId ? [activeLayerId] : [])]).size >= 2 || isActiveGroup) && (
              <div className={styles.menuDivider} />
            )}
            <button
              className={styles.menuItem}
              disabled={new Set([...selectedIds, ...(activeLayerId ? [activeLayerId] : [])]).size < 2}
              onMouseDown={execMergeSelected}
            >
              Merge Selected
            </button>
            <button
              className={styles.menuItem}
              disabled={layers.filter((l) => l.visible && !('type' in l && (l.type === 'mask' || l.type === 'adjustment'))).length < 2}
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
              disabled={layers.filter(l => !('type' in l && (l.type === 'mask' || l.type === 'adjustment'))).length < 2}
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
