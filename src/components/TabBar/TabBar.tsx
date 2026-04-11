import React from 'react'
import { useAppContext } from '@/store/AppContext'
import styles from './TabBar.module.scss'

export function TabBar(): React.JSX.Element {
  const { state } = useAppContext()
  const zoom = Math.round(state.canvas.zoom * 100)

  return (
    <div className={styles.tabBar}>
      <button className={styles.collapseBtn} aria-label="Collapse panel">
        <svg viewBox="0 0 8 8" fill="currentColor" width="8" height="8">
          <path d="M2 0l4 4-4 4z" />
        </svg>
      </button>

      <div className={styles.tab} role="tab" aria-selected="true">
        <span className={styles.indicator} />
        <span className={styles.tabName}>Untitled-1.png @ {zoom}% (RGB/8#)</span>
        <button className={styles.closeBtn} aria-label="Close tab" title="Close">×</button>
      </div>
    </div>
  )
}
