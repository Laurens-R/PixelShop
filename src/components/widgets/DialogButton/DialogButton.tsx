import React from 'react'
import styles from './DialogButton.module.scss'

export interface DialogButtonProps {
  onClick: () => void
  primary?: boolean
  title?: string
  children: React.ReactNode
}

export function DialogButton({ onClick, primary, title, children }: DialogButtonProps): React.JSX.Element {
  return (
    <button
      className={primary ? `${styles.btn} ${styles.btnPrimary}` : styles.btn}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
