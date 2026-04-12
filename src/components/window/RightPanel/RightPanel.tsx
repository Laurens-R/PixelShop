import React, { useRef, useState } from 'react'
import { useAppContext } from '@/store/AppContext'
import { ColorPicker } from '@/components/panels/ColorPicker/ColorPicker'
import { LayerPanel } from '@/components/panels/LayerPanel/LayerPanel'
import { Navigator } from '@/components/panels/Navigator/Navigator'
import { SwatchPanel } from '@/components/panels/Swatch/SwatchPanel'
import styles from './RightPanel.module.scss'

type ColorTab = 'Color' | 'Swatches' | 'Navigator'
type LayerTab = 'Layers' | 'Info'

export function RightPanel(): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const [colorTab, setColorTab]   = useState<ColorTab>('Color')
  const [layerTab, setLayerTab]   = useState<LayerTab>('Layers')
  const [colorTabs, setColorTabs] = useState<ColorTab[]>(['Color', 'Swatches', 'Navigator'])
  const [layerTabs, setLayerTabs] = useState<LayerTab[]>(['Layers', 'Info'])

  const colorDragSrc = useRef<number | null>(null)
  const layerDragSrc = useRef<number | null>(null)
  const [colorDragOver, setColorDragOver] = useState<number | null>(null)
  const [layerDragOver, setLayerDragOver] = useState<number | null>(null)

  function makeDragHandlers<T extends string>(
    tabs: T[],
    setTabs: React.Dispatch<React.SetStateAction<T[]>>,
    dragSrc: React.MutableRefObject<number | null>,
    setDragOver: React.Dispatch<React.SetStateAction<number | null>>,
  ) {
    return {
      onDragStart: (idx: number, e: React.DragEvent) => {
        dragSrc.current = idx
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (idx: number, e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDragOver(idx)
      },
      onDragLeave: () => setDragOver(null),
      onDrop: (idx: number, e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(null)
        const src = dragSrc.current
        if (src === null || src === idx) return
        const next = [...tabs]
        const [moved] = next.splice(src, 1)
        next.splice(idx, 0, moved)
        setTabs(next)
        dragSrc.current = null
      },
      onDragEnd: () => { dragSrc.current = null; setDragOver(null) },
    }
  }

  const colorDrag = makeDragHandlers(colorTabs, setColorTabs, colorDragSrc, setColorDragOver)
  const layerDrag = makeDragHandlers(layerTabs, setLayerTabs, layerDragSrc, setLayerDragOver)

  return (
    <aside className={styles.panel}>
      {/* ── Color section ───────────────────────────────────────────────── */}
      <div className={styles.section} style={{ flex: '0 0 auto' }}>
        <div className={styles.tabRow}>
          {colorTabs.map((t, i) => (
            <button
              key={t}
              draggable
              className={[
                styles.tab,
                colorTab === t ? styles.tabActive : '',
                colorDragOver === i ? styles.tabDragOver : '',
              ].join(' ')}
              onClick={() => setColorTab(t)}
              onDragStart={(e) => colorDrag.onDragStart(i, e)}
              onDragOver={(e)  => colorDrag.onDragOver(i, e)}
              onDragLeave={colorDrag.onDragLeave}
              onDrop={(e)      => colorDrag.onDrop(i, e)}
              onDragEnd={colorDrag.onDragEnd}
            >
              {t}
            </button>
          ))}
          <div className={styles.tabSpacer} />
          <button className={styles.tabMenu} aria-label="Panel options">
            <svg viewBox="0 0 10 10" fill="currentColor" width="10" height="10">
              <rect x="0" y="2" width="10" height="1.2" />
              <rect x="0" y="5" width="10" height="1.2" />
              <rect x="0" y="8" width="10" height="1.2" />
            </svg>
          </button>
        </div>

        {colorTab === 'Color' && (
          <ColorPicker
            primaryColor={state.primaryColor}
            secondaryColor={state.secondaryColor}
            onPrimaryChange={(c) => dispatch({ type: 'SET_PRIMARY_COLOR', payload: c })}
            onSecondaryChange={(c) => dispatch({ type: 'SET_SECONDARY_COLOR', payload: c })}
          />
        )}
        {colorTab === 'Swatches' && (
          <SwatchPanel />
        )}
        {colorTab === 'Navigator' && (
          <Navigator />
        )}
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <div className={styles.divider} />

      {/* ── Layers section ──────────────────────────────────────────────── */}
      <div className={styles.section} style={{ flex: '1 1 0', minHeight: 0 }}>
        <div className={styles.tabRow}>
          {layerTabs.map((t, i) => (
            <button
              key={t}
              draggable
              className={[
                styles.tab,
                layerTab === t ? styles.tabActive : '',
                layerDragOver === i ? styles.tabDragOver : '',
              ].join(' ')}
              onClick={() => setLayerTab(t)}
              onDragStart={(e) => layerDrag.onDragStart(i, e)}
              onDragOver={(e)  => layerDrag.onDragOver(i, e)}
              onDragLeave={layerDrag.onDragLeave}
              onDrop={(e)      => layerDrag.onDrop(i, e)}
              onDragEnd={layerDrag.onDragEnd}
            >
              {t}
            </button>
          ))}
          <div className={styles.tabSpacer} />
          <button className={styles.tabMenu} aria-label="Panel options">
            <svg viewBox="0 0 10 10" fill="currentColor" width="10" height="10">
              <rect x="0" y="2" width="10" height="1.2" />
              <rect x="0" y="5" width="10" height="1.2" />
              <rect x="0" y="8" width="10" height="1.2" />
            </svg>
          </button>
        </div>

        {layerTab === 'Layers' && (
          <LayerPanel
            layers={state.layers}
            activeLayerId={state.activeLayerId ?? undefined}
            onActiveLayerChange={(id) => dispatch({ type: 'SET_ACTIVE_LAYER', payload: id })}
            onLayerAdd={() => {
              const id = `layer-${Date.now()}`
              dispatch({
                type: 'ADD_LAYER',
                payload: {
                  id,
                  name: `Layer ${state.layers.length + 1}`,
                  visible: true,
                  opacity: 1,
                  locked: false,
                  blendMode: 'normal'
                }
              })
            }}
            onLayerDelete={(id) => dispatch({ type: 'REMOVE_LAYER', payload: id })}
            onLayerToggleVisibility={(id) => dispatch({ type: 'TOGGLE_LAYER_VISIBILITY', payload: id })}
            onLayerToggleLock={(id) => dispatch({ type: 'TOGGLE_LAYER_LOCK', payload: id })}
            onLayerOpacityChange={(id, opacity) =>
              dispatch({ type: 'SET_LAYER_OPACITY', payload: { id, opacity } })
            }
            onLayerBlendChange={(id, blendMode) =>
              dispatch({ type: 'SET_LAYER_BLEND', payload: { id, blendMode } })
            }
            onLayerRename={(id, name) =>
              dispatch({ type: 'RENAME_LAYER', payload: { id, name } })
            }
            onLayersReorder={(layers) =>
              dispatch({ type: 'REORDER_LAYERS', payload: layers })
            }
          />
        )}
        {layerTab !== 'Layers' && (
          <div className={styles.placeholder}>{layerTab}</div>
        )}
      </div>
    </aside>
  )
}
