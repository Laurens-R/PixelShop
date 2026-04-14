import React, { useRef, useState } from 'react'
import { ColorPicker } from '@/components/panels/ColorPicker/ColorPicker'
import { LayerPanel } from '@/components/panels/LayerPanel/LayerPanel'
import { Navigator } from '@/components/panels/Navigator/Navigator'
import { SwatchPanel } from '@/components/panels/Swatch/SwatchPanel'
import { HistoryPanel } from '@/components/panels/History/HistoryPanel'
import styles from './RightPanel.module.scss'

type ColorTab = 'Color' | 'Swatches' | 'Navigator'
type LayerTab = 'Layers' | 'History' | 'Info'

interface RightPanelProps {
  onMergeSelected: (ids: string[]) => void
  onMergeVisible: () => void
  onMergeDown: () => void
  onFlattenImage: () => void
}

export function RightPanel({ onMergeSelected, onMergeVisible, onMergeDown, onFlattenImage }: RightPanelProps): React.JSX.Element {
  const [colorTab, setColorTab]   = useState<ColorTab>('Color')
  const [layerTab, setLayerTab]   = useState<LayerTab>('Layers')
  const [colorTabs, setColorTabs] = useState<ColorTab[]>(['Color', 'Swatches', 'Navigator'])
  const [layerTabs, setLayerTabs] = useState<LayerTab[]>(['Layers', 'History', 'Info'])

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

        {colorTab === 'Color' && <ColorPicker />}
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
            onMergeSelected={onMergeSelected}
            onMergeVisible={onMergeVisible}
            onMergeDown={onMergeDown}
            onFlattenImage={onFlattenImage}
          />
        )}
        {layerTab === 'History' && (
          <HistoryPanel />
        )}
        {layerTab === 'Info' && (
          <div className={styles.placeholder}>{layerTab}</div>
        )}
      </div>
    </aside>
  )
}
