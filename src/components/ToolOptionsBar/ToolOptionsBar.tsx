import React from 'react'
import { useAppContext } from '@/store/AppContext'
import { TOOL_REGISTRY } from '@/tools'
import type { ToolOptionsStyles } from '@/tools'
import styles from './ToolOptionsBar.module.scss'

export function ToolOptionsBar(): React.JSX.Element {
  const { state } = useAppContext()
  const { Options } = TOOL_REGISTRY[state.activeTool]

  return (
    <div className={styles.bar} role="toolbar" aria-label="Tool options">
      <Options styles={styles as unknown as ToolOptionsStyles} />
    </div>
  )
}
