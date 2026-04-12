import React from 'react'
import { useAppContext } from '@/store/AppContext'
import styles from './SwatchPanel.module.scss'

export function SwatchPanel(): React.JSX.Element {
  const { state, dispatch } = useAppContext()

  return (
    <div className={styles.swatchesPanel}>
      {state.swatches.map((sw, i) => {
        const hex = `#${[sw.r, sw.g, sw.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
        return (
          <button
            key={i}
            className={styles.swatchCell}
            style={{ background: hex }}
            title={hex.toUpperCase()}
            aria-label={`Swatch ${hex.toUpperCase()}`}
            onClick={() => dispatch({ type: 'SET_PRIMARY_COLOR', payload: sw })}
            onContextMenu={(e) => {
              e.preventDefault()
              dispatch({ type: 'REMOVE_SWATCH', payload: i })
            }}
          />
        )
      })}
      {state.swatches.length === 0 && (
        <span className={styles.swatchesEmpty}>No swatches yet. Add colors from the Color Picker.</span>
      )}
    </div>
  )
}
