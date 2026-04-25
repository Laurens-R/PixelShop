import React from 'react'
import { useAppContext } from '@/store/AppContext'
import type { HueSaturationAdjustmentLayer } from '@/types'
import { SliderInput } from '@/components/widgets/SliderInput/SliderInput'
import styles from './HueSaturationPanel.module.scss'

// ─── Props ────────────────────────────────────────────────────────────────────

interface HueSaturationPanelProps {
  layer: HueSaturationAdjustmentLayer
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const GearIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2"
    width="10" height="10" aria-hidden="true">
    <circle cx="6" cy="6" r="1.8" />
    <path d="M6 1v1.2M6 9.8V11M1 6h1.2M9.8 6H11M2.5 2.5l.85.85M8.65 8.65l.85.85M9.5 2.5l-.85.85M3.35 8.65l-.85.85" strokeLinecap="round" />
  </svg>
)

// ─── Component ────────────────────────────────────────────────────────────────

export function HueSaturationPanel({ layer }: HueSaturationPanelProps): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const { layers } = state

  const parentLayer = layers.find(l => l.id === layer.parentId)
  const parentLayerName = parentLayer?.name ?? 'Layer'

  const { hue, saturation, lightness } = layer.params

  return (
    <div className={styles.content}>
      <div className={styles.row}>
        <span className={styles.label}>Hue</span>
        <SliderInput
          value={hue}
          min={-180}
          max={180}
          step={1}
          inputWidth={40}
          onChange={(v) =>
            dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { ...layer.params, hue: v } } })
          }
        />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Saturation</span>
        <SliderInput
          value={saturation}
          min={-100}
          max={100}
          step={1}
          inputWidth={40}
          onChange={(v) =>
            dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { ...layer.params, saturation: v } } })
          }
        />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Lightness</span>
        <SliderInput
          value={lightness}
          min={-100}
          max={100}
          step={1}
          inputWidth={40}
          onChange={(v) =>
            dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { ...layer.params, lightness: v } } })
          }
        />
      </div>
      <div className={styles.footer}>
        <span className={styles.footerInfo}>
          <GearIcon />
          Adjusting {parentLayerName}
        </span>
        <button
          className={styles.resetBtn}
          onClick={() =>
            dispatch({ type: 'UPDATE_ADJUSTMENT_LAYER', payload: { ...layer, params: { hue: 0, saturation: 0, lightness: 0 } } })
          }
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
