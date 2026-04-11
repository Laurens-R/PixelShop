import React from 'react'
import { useAppContext } from '@/store/AppContext'
import styles from './StatusBar.module.scss'

export function StatusBar(): React.JSX.Element {
  const { state } = useAppContext()
  const zoom = Math.round(state.canvas.zoom * 100)
  const { width, height } = state.canvas

  return (
    <div className={styles.statusBar}>
      {/* Left: doc info */}
      <div className={styles.docInfo}>
        <span className={styles.infoItem}>{width} × {height} px</span>
        <span className={styles.sep} />
        <span className={styles.infoItem}>RGB/8</span>
      </div>

      {/* Right: zoom */}
      <div className={styles.zoom}>
        <span className={styles.infoItem}>{zoom}%</span>
      </div>
    </div>
  )
}
