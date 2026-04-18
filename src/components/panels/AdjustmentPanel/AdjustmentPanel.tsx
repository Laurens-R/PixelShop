import React, { useEffect } from 'react'
import { useAppContext } from '@/store/AppContext'
import type { AdjustmentLayerState, BrightnessContrastAdjustmentLayer, HueSaturationAdjustmentLayer, ColorVibranceAdjustmentLayer, ColorBalanceAdjustmentLayer, BlackAndWhiteAdjustmentLayer, ColorTemperatureAdjustmentLayer, ColorInvertAdjustmentLayer, SelectiveColorAdjustmentLayer, CurvesAdjustmentLayer, ColorGradingAdjustmentLayer } from '@/types'
import type { CanvasHandle } from '@/components/window/Canvas/Canvas'
import { BrightnessContrastPanel } from '../BrightnessContrastPanel/BrightnessContrastPanel'
import { HueSaturationPanel } from '../HueSaturationPanel/HueSaturationPanel'
import { ColorVibrancePanel } from '../ColorVibrancePanel/ColorVibrancePanel'
import { ColorBalancePanel } from '../ColorBalancePanel/ColorBalancePanel'
import { BlackAndWhitePanel } from '../BlackAndWhitePanel/BlackAndWhitePanel'
import { ColorTemperaturePanel } from '../ColorTemperaturePanel/ColorTemperaturePanel'
import { InvertPanel } from '../InvertPanel/InvertPanel'
import { SelectiveColorPanel } from '../SelectiveColorPanel/SelectiveColorPanel'
import { CurvesPanel } from '../CurvesPanel/CurvesPanel'
import { ColorGradingPanel } from '../ColorGradingPanel/ColorGradingPanel'
import styles from './AdjustmentPanel.module.scss'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AdjustmentPanelProps {
  onClose: () => void
  canvasHandleRef?: { readonly current: CanvasHandle | null }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function adjustmentTitle(layer: AdjustmentLayerState): string {
  switch (layer.adjustmentType) {
    case 'brightness-contrast': return 'Brightness/Contrast'
    case 'hue-saturation':      return 'Hue/Saturation'
    case 'color-vibrance':      return 'Color Vibrance'
    case 'color-balance':       return 'Color Balance'
    case 'black-and-white':     return 'Black and White'
    case 'color-temperature':   return 'Color Temperature'
    case 'color-invert':        return 'Invert'
    case 'selective-color':     return 'Selective Color'
    case 'curves':              return 'Curves'
    case 'color-grading':       return 'Color Grading'
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

const ColorBalanceHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="1.5" x2="6" y2="10.5" />
    <line x1="2" y1="4" x2="10" y2="4" />
    <polygon points="2,4 1.1,6.2 2.9,6.2" fill="currentColor" stroke="none" />
    <polygon points="10,4 9.1,6.2 10.9,6.2" fill="currentColor" stroke="none" />
    <line x1="4.5" y1="10.5" x2="7.5" y2="10.5" />
  </svg>
)

const BlackAndWhiteHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 1.5 A4.5 4.5 0 0 0 6 10.5 Z" fill="currentColor" />
    <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

const ColorTemperatureHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="1" x2="6" y2="7" />
    <circle cx="6" cy="9" r="2" />
    <line x1="8.5" y1="2" x2="10" y2="2" />
    <line x1="8.5" y1="4" x2="9.5" y2="4" />
    <line x1="8.5" y1="6" x2="10" y2="6" />
  </svg>
)

const ColorInvertHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 1.5 A4.5 4.5 0 0 1 6 10.5 Z" fill="currentColor" />
    <path d="M6 1.5 A4.5 4.5 0 0 0 6 10.5 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

const SelectiveColorHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
    <circle cx="4.5" cy="4.5" r="2.8" stroke="#ff6060" />
    <circle cx="7.5" cy="4.5" r="2.8" stroke="#60d060" />
    <circle cx="6" cy="7" r="2.8" stroke="#6060ff" />
  </svg>
)

const CurvesHeaderIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" width="12" height="12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 9.5 C3.2 9.5 3.9 5.8 5.7 5.8 C7 5.8 7.2 7.4 8.7 7.4 C10 7.4 10.5 3.2 10.5 2.2" />
    <circle cx="1.5" cy="9.5" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="2.2" r="0.8" fill="currentColor" stroke="none" />
  </svg>
)

const ColorGradingHeaderIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="3" cy="6" r="1.8" />
    <circle cx="9" cy="6" r="1.8" />
    <circle cx="6" cy="3" r="1.8" />
    <circle cx="6" cy="9" r="1.8" />
  </svg>
)

function AdjPanelIcon({ type }: { type: AdjustmentLayerState['adjustmentType'] }): React.JSX.Element {
  if (type === 'brightness-contrast') return <BrightnessContrastHeaderIcon />
  if (type === 'hue-saturation') return <HueSaturationHeaderIcon />
  if (type === 'color-balance') return <ColorBalanceHeaderIcon />
  if (type === 'black-and-white') return <BlackAndWhiteHeaderIcon />
  if (type === 'color-temperature') return <ColorTemperatureHeaderIcon />
  if (type === 'color-invert') return <ColorInvertHeaderIcon />
  if (type === 'selective-color') return <SelectiveColorHeaderIcon />
  if (type === 'curves') return <CurvesHeaderIcon />
  if (type === 'color-grading') return <ColorGradingHeaderIcon />
  return <ColorVibranceHeaderIcon />
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdjustmentPanel({ onClose, canvasHandleRef }: AdjustmentPanelProps): React.JSX.Element | null {
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
    <div className={[
      styles.panel,
      adjLayer.adjustmentType === 'curves' ? styles.panelWide : '',
      adjLayer.adjustmentType === 'color-grading' ? styles.panelColorGrading : '',
    ].join(' ')} role="dialog" aria-label={adjustmentTitle(adjLayer)}>
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
        {adjLayer.adjustmentType === 'color-balance' && (
          <ColorBalancePanel layer={adjLayer as ColorBalanceAdjustmentLayer} parentLayerName={parentLayerName} />
        )}
        {adjLayer.adjustmentType === 'black-and-white' && (
          <BlackAndWhitePanel layer={adjLayer as BlackAndWhiteAdjustmentLayer} parentLayerName={parentLayerName} />
        )}
        {adjLayer.adjustmentType === 'color-temperature' && (
          <ColorTemperaturePanel layer={adjLayer as ColorTemperatureAdjustmentLayer} parentLayerName={parentLayerName} />
        )}
        {adjLayer.adjustmentType === 'color-invert' && (
          <InvertPanel layer={adjLayer as ColorInvertAdjustmentLayer} parentLayerName={parentLayerName} />
        )}
        {adjLayer.adjustmentType === 'selective-color' && (
          <SelectiveColorPanel layer={adjLayer as SelectiveColorAdjustmentLayer} parentLayerName={parentLayerName} />
        )}
        {adjLayer.adjustmentType === 'curves' && (
          <CurvesPanel
            layer={adjLayer as CurvesAdjustmentLayer}
            parentLayerName={parentLayerName}
            canvasHandleRef={canvasHandleRef}
          />
        )}
        {adjLayer.adjustmentType === 'color-grading' && (
          <ColorGradingPanel
            layer={adjLayer as ColorGradingAdjustmentLayer}
            parentLayerName={parentLayerName}
          />
        )}
      </div>
    </div>
  )
}
