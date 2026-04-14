import React, { useEffect } from 'react'
import { useAppContext } from '@/store/AppContext'
import type { AdjustmentLayerState, BrightnessContrastAdjustmentLayer, HueSaturationAdjustmentLayer, ColorVibranceAdjustmentLayer } from '@/types'
import { BrightnessContrastPanel } from '../BrightnessContrastPanel/BrightnessContrastPanel'
import { HueSaturationPanel } from '../HueSaturationPanel/HueSaturationPanel'
import { ColorVibrancePanel } from '../ColorVibrancePanel/ColorVibrancePanel'
import styles from './AdjustmentPanel.module.scss'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AdjustmentPanelProps {
  onClose: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function adjustmentTitle(layer: AdjustmentLayerState): string {
  switch (layer.adjustmentType) {
    case 'brightness-contrast': return 'Brightness/Contrast'
    case 'hue-saturation':      return 'Hue/Saturation'
    case 'color-vibrance':      return 'Color Vibrance'
  }
}

const CloseIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" width="10" height="10" aria-hidden="true">
    <line x1="1" y1="1" x2="11" y2="11" />
    <line x1="11" y1="1" x2="1" y2="11" />
  </svg>
)

const BrightnessContrastHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="6" cy="6" r="2" />
    <path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.5 2.5l.7.7M8.8 8.8l.7.7M9.5 2.5l-.7.7M3.2 8.8l-.7.7" />
  </svg>
)

const HueSaturationHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" />
  </svg>
)

const ColorVibranceHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="6" cy="6" r="1.8" />
    <circle cx="6" cy="6" r="4" />
  </svg>
)

function AdjPanelIcon({ type }: { type: AdjustmentLayerState['adjustmentType'] }): React.JSX.Element {
  if (type === 'brightness-contrast') return <BrightnessContrastHeaderIcon />
  if (type === 'hue-saturation') return <HueSaturationHeaderIcon />
  return <ColorVibranceHeaderIcon />
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdjustmentPanel({ onClose }: AdjustmentPanelProps): React.JSX.Element | null {
  const { state } = useAppContext()
  const { openAdjustmentLayerId, layers } = state

  const layer = openAdjustmentLayerId !== null
    ? layers.find(l => l.id === openAdjustmentLayerId)
    : undefined

  useEffect(() => {
    if (!openAdjustmentLayerId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openAdjustmentLayerId, onClose])

  if (!layer || !('type' in layer) || layer.type !== 'adjustment') return null

  const adjLayer = layer as AdjustmentLayerState
  const parentLayer = layers.find(l => l.id === adjLayer.parentId)
  const parentLayerName = parentLayer?.name ?? 'Layer'

  return (
    <div className={styles.panel} role="dialog" aria-label={adjustmentTitle(adjLayer)}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>
          <AdjPanelIcon type={adjLayer.adjustmentType} />
        </span>
        <span className={styles.title}>{adjustmentTitle(adjLayer)}</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close panel" title="Close">
          <CloseIcon />
        </button>
      </div>
      <div className={styles.body}>
        {adjLayer.adjustmentType === 'brightness-contrast' && (
          <BrightnessContrastPanel layer={adjLayer as BrightnessContrastAdjustmentLayer} parentLayerName={parentLayerName} />
        )}
        {adjLayer.adjustmentType === 'hue-saturation' && (
          <HueSaturationPanel layer={adjLayer as HueSaturationAdjustmentLayer} parentLayerName={parentLayerName} />
        )}
        {adjLayer.adjustmentType === 'color-vibrance' && (
          <ColorVibrancePanel layer={adjLayer as ColorVibranceAdjustmentLayer} parentLayerName={parentLayerName} />
        )}
      </div>
    </div>
  )
}
