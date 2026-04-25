import React from 'react'
import { ModalDialog } from '../../modals/ModalDialog/ModalDialog'
import { DialogButton } from '../../widgets/DialogButton/DialogButton'
import styles from './AboutDialog.module.scss'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AboutDialog({ open, onClose }: AboutDialogProps): React.JSX.Element | null {
  return (
    <ModalDialog open={open} title="About PixelShop" width={380} onClose={onClose}>
      <div className={styles.body}>
        <div className={styles.logo} aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="currentColor" width="44" height="44">
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </div>

        <h1 className={styles.name}>PixelShop</h1>
        <p className={styles.version}>Version 0.1.0</p>

        <p className={styles.desc}>
          A pixel art and image editor inspired by Photoshop, built for the desktop.
        </p>

        <p className={styles.tech}>
          Electron · React 19 · TypeScript · WebGL2 · C++/WASM
        </p>
      </div>

      <div className={styles.footer}>
        <DialogButton onClick={onClose} primary>Close</DialogButton>
      </div>
    </ModalDialog>
  )
}
