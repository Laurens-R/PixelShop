import React, { useState } from 'react'
import type { RGBAColor } from '@/types'
import { EmbedColorPicker, hexToRgb, toHex } from '@/components/widgets/EmbedColorPicker/EmbedColorPicker'
import styles from './ColorPicker.module.scss'

// ─── Component ────────────────────────────────────────────────────────────────

interface ColorPickerProps {
  primaryColor?: RGBAColor
  secondaryColor?: RGBAColor
  onPrimaryChange?: (color: RGBAColor) => void
  onSecondaryChange?: (color: RGBAColor) => void
}

export function ColorPicker({
  primaryColor = { r: 0, g: 0, b: 0, a: 255 },
  secondaryColor = { r: 255, g: 255, b: 255, a: 255 },
  onPrimaryChange,
  onSecondaryChange,
}: ColorPickerProps): React.JSX.Element {
  const [active, setActive] = useState<'fg' | 'bg'>('fg')

  const fgHex = toHex(primaryColor.r, primaryColor.g, primaryColor.b)
  const bgHex = toHex(secondaryColor.r, secondaryColor.g, secondaryColor.b)
  const activeHex = active === 'fg' ? fgHex : bgHex

  const handleChange = (hex: string): void => {
    const [r, g, b] = hexToRgb(hex)
    const color: RGBAColor = { r, g, b, a: 255 }
    if (active === 'fg') onPrimaryChange?.(color)
    else onSecondaryChange?.(color)
  }

  return (
    <div className={styles.picker}>
      {/* FG / BG swatches */}
      <div className={styles.swatchRow}>
        <div className={styles.swatchStack}>
          <button
            className={`${styles.swatch} ${styles.swatchBack} ${active === 'bg' ? styles.swatchSel : ''}`}
            style={{ background: bgHex }}
            onClick={() => setActive('bg')}
            aria-label="Background color"
            title="Background (click to edit)"
          />
          <button
            className={`${styles.swatch} ${styles.swatchFront} ${active === 'fg' ? styles.swatchSel : ''}`}
            style={{ background: fgHex }}
            onClick={() => setActive('fg')}
            aria-label="Foreground color"
            title="Foreground (click to edit)"
          />
        </div>
        <span className={styles.swatchLabel}>{active === 'fg' ? 'Foreground' : 'Background'}</span>
      </div>

      <EmbedColorPicker value={activeHex} onChange={handleChange} />
    </div>
  )
}
