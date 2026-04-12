import React from 'react'
import { useAppContext } from '@/store/AppContext'
import styles from './TabBar.module.scss'

export function TabBar(): React.JSX.Element {
  const { state } = useAppContext()
  const zoom = Math.round(state.canvas.zoom * 100)

  return (
    <div className={styles.tabBar}>
      <div className={styles.tab} role="tab" aria-selected="true">
        <span className={styles.indicator} />
        <span className={styles.tabName}>Untitled-1.png @ {zoom}% (RGB/8#)</span>
        <button className={styles.closeBtn} aria-label="Close tab" title="Close">×</button>
      </div>
    </div>
  )
}
