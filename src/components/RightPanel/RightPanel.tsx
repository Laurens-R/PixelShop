import React, { useState } from 'react'
import { useAppContext } from '@/store/AppContext'
import { ColorPicker } from '@/components/ColorPicker/ColorPicker'
import { LayerPanel } from '@/components/LayerPanel/LayerPanel'
import { Navigator } from '@/components/Navigator/Navigator'
import styles from './RightPanel.module.scss'

type ColorTab = 'Color' | 'Swatches' | 'Navigator'
type LayerTab = 'Layers' | 'Paths' | 'Properties' | 'Info'

const COLOR_TABS: ColorTab[] = ['Color', 'Swatches', 'Navigator']
const LAYER_TABS: LayerTab[] = ['Layers', 'Paths', 'Properties', 'Info']

export function RightPanel(): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const [colorTab, setColorTab] = useState<ColorTab>('Color')
  const [layerTab, setLayerTab] = useState<LayerTab>('Layers')

  return (
    <aside className={styles.panel}>
      {/* ── Color section ───────────────────────────────────────────────── */}
      <div className={styles.section} style={{ flex: '0 0 auto' }}>
        <div className={styles.tabRow}>
          {COLOR_TABS.map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${colorTab === t ? styles.tabActive : ''}`}
              onClick={() => setColorTab(t)}
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
          <div className={styles.placeholder}>Swatches</div>
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
          {LAYER_TABS.map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${layerTab === t ? styles.tabActive : ''}`}
              onClick={() => setLayerTab(t)}
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
                  locked: false
                }
              })
            }}
            onLayerDelete={(id) => dispatch({ type: 'REMOVE_LAYER', payload: id })}
            onLayerToggleVisibility={(id) =>
              dispatch({ type: 'TOGGLE_LAYER_VISIBILITY', payload: id })
            }
            onLayerOpacityChange={(id, opacity) =>
              dispatch({ type: 'SET_LAYER_OPACITY', payload: { id, opacity } })
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
