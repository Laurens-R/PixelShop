import React, { useEffect, useRef, useMemo, useState } from 'react'
import ReactDOM from 'react-dom'
import { useAppContext } from '@/store/AppContext'
import { usePaletteFileOps } from '@/hooks/usePaletteFileOps'
import { sortSwatchesByHue } from '@/utils/swatchSort'
import styles from './SwatchPanel.module.scss'

interface SwatchPanelProps {
  onGeneratePalette?: () => void
}

export function SwatchPanel({ onGeneratePalette }: SwatchPanelProps): React.JSX.Element {
  const { state, dispatch } = useAppContext()
  const { handleSavePalette, handleSavePaletteAs, handleOpenPalette, paletteError, clearPaletteError } =
    usePaletteFileOps({ swatches: state.swatches, dispatch })
  const displaySwatches = useMemo(() => sortSwatchesByHue(state.swatches), [state.swatches])
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      const inBtn = menuBtnRef.current?.contains(target) ?? false
      const inDrop = dropdownRef.current?.contains(target) ?? false
      if (!inBtn && !inDrop) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  function openMenu() {
    if (!menuBtnRef.current) return
    const rect = menuBtnRef.current.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom + 3, right: window.innerWidth - rect.right })
    setMenuOpen(o => !o)
  }

  return (
    <div className={styles.panelBody}>
      <div className={styles.actions}>
      <div className={styles.menuWrap}>
          <button
            ref={menuBtnRef}
            type="button"
            className={styles.menuBtn}
            aria-label="Palette file options"
            aria-expanded={menuOpen}
            onClick={openMenu}
          >
            ≡
          </button>
          {menuOpen && ReactDOM.createPortal(
            <div
              ref={dropdownRef}
              className={styles.dropdown}
              style={{ position: 'fixed', top: dropdownPos.top, right: dropdownPos.right }}
            >
              <button
                type="button"
                className={styles.dropdownItem}
                onClick={() => { setMenuOpen(false); onGeneratePalette?.() }}
              >
                Generate Palette…
              </button>
              <div className={styles.dropdownSeparator} />
              <button
                type="button"
                className={styles.dropdownItem}
                onClick={() => { setMenuOpen(false); void handleSavePalette() }}
              >
                Save Palette
              </button>
              <button
                type="button"
                className={styles.dropdownItem}
                onClick={() => { setMenuOpen(false); void handleSavePaletteAs() }}
              >
                Save Palette As…
              </button>
              <div className={styles.dropdownSeparator} />
              <button
                type="button"
                className={styles.dropdownItem}
                onClick={() => { setMenuOpen(false); void handleOpenPalette() }}
              >
                Open Palette…
              </button>
              <div className={styles.dropdownSeparator} />
              <button
                type="button"
                className={styles.dropdownItem}
                onClick={() => { setMenuOpen(false); dispatch({ type: 'SET_SWATCHES', payload: [] }) }}
              >
                Clear Palette
              </button>
            </div>,
            document.body
          )}
        </div>
      </div>
      {paletteError != null && (
        <div className={styles.errorBanner}>
          <span className={styles.errorText}>{paletteError}</span>
          <button
            type="button"
            className={styles.errorDismiss}
            aria-label="Dismiss error"
            onClick={() => clearPaletteError()}
          >
            ×
          </button>
        </div>
      )}
      <div className={styles.swatchGrid}>
        {displaySwatches.map((sw, i) => {
          const hex = `#${[sw.r, sw.g, sw.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
          const isActive =
            sw.r === state.primaryColor.r &&
            sw.g === state.primaryColor.g &&
            sw.b === state.primaryColor.b &&
            sw.a === state.primaryColor.a
          return (
            <button
              key={`${sw.r}-${sw.g}-${sw.b}-${sw.a}-${i}`}
              className={`${styles.swatchCell}${isActive ? ` ${styles.swatchSelected}` : ''}`}
              style={{ background: hex }}
              title={hex.toUpperCase()}
              aria-label={`Swatch ${hex.toUpperCase()}`}
              onClick={() => dispatch({ type: 'SET_PRIMARY_COLOR', payload: sw })}
              onContextMenu={(e) => {
                e.preventDefault()
                const idx = state.swatches.findIndex(
                  (s) => s.r === sw.r && s.g === sw.g && s.b === sw.b && s.a === sw.a
                )
                if (idx !== -1) dispatch({ type: 'REMOVE_SWATCH', payload: idx })
              }}
            />
          )
        })}
        {state.swatches.length === 0 && (
          <span className={styles.swatchesEmpty}>No swatches yet. Add colors from the Color Picker.</span>
        )}
      </div>
    </div>
  )
}
