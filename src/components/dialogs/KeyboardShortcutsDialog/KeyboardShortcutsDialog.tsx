import React from 'react'
import { ModalDialog } from '../ModalDialog/ModalDialog'
import { DialogButton } from '../../widgets/DialogButton/DialogButton'
import styles from './KeyboardShortcutsDialog.module.scss'

// ─── Data ─────────────────────────────────────────────────────────────────────

interface ShortcutRow {
  keys: string
  action: string
}

interface ShortcutGroup {
  label: string
  rows: ShortcutRow[]
}

const GROUPS: ShortcutGroup[] = [
  {
    label: 'File',
    rows: [
      { keys: 'Ctrl+N',         action: 'New Image' },
      { keys: 'Ctrl+O',         action: 'Open…' },
      { keys: 'Ctrl+S',         action: 'Save' },
      { keys: 'Ctrl+Shift+S',   action: 'Save As…' },
      { keys: 'Ctrl+E',         action: 'Export As…' },
    ],
  },
  {
    label: 'Edit',
    rows: [
      { keys: 'Ctrl+Z', action: 'Undo' },
      { keys: 'Ctrl+Y', action: 'Redo' },
      { keys: 'Ctrl+X', action: 'Cut' },
      { keys: 'Ctrl+C', action: 'Copy' },
      { keys: 'Ctrl+V', action: 'Paste' },
      { keys: 'Delete',  action: 'Delete' },
    ],
  },
  {
    label: 'View',
    rows: [
      { keys: 'Ctrl+=', action: 'Zoom In' },
      { keys: 'Ctrl+-', action: 'Zoom Out' },
      { keys: 'Ctrl+0', action: 'Fit to Window' },
      { keys: 'Ctrl+G', action: 'Toggle Grid' },
    ],
  },
  {
    label: 'Layer',
    rows: [
      { keys: 'Ctrl+Shift+N', action: 'New Layer' },
    ],
  },
  {
    label: 'Tools',
    rows: [
      { keys: 'V', action: 'Move' },
      { keys: 'M', action: 'Marquee Select' },
      { keys: 'L', action: 'Lasso' },
      { keys: 'W', action: 'Magic Wand' },
      { keys: 'C', action: 'Crop' },
      { keys: 'I', action: 'Eyedropper' },
      { keys: 'B', action: 'Brush' },
      { keys: 'N', action: 'Pencil' },
      { keys: 'E', action: 'Eraser' },
      { keys: 'G', action: 'Fill / Gradient' },
      { keys: 'O', action: 'Dodge / Burn' },
      { keys: 'T', action: 'Text' },
      { keys: 'U', action: 'Shape' },
      { keys: 'K', action: 'Frame' },
    ],
  },
  {
    label: 'Other',
    rows: [
      { keys: 'Escape', action: 'Clear Selection / Cancel Crop' },
      { keys: '?',      action: 'Show Keyboard Shortcuts' },
    ],
  },
]

// ─── Key renderer ─────────────────────────────────────────────────────────────

function Keys({ value }: { value: string }): React.JSX.Element {
  const parts = value.split('+')
  return (
    <>
      {parts.map((k, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className={styles.plus}>+</span>}
          <kbd className={styles.kbd}>{k}</kbd>
        </React.Fragment>
      ))}
    </>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeyboardShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps): React.JSX.Element | null {
  return (
    <ModalDialog open={open} title="Keyboard Shortcuts" width={460} onClose={onClose}>
      <div className={styles.body}>
        <div className={styles.columns}>
          {GROUPS.map((group) => (
            <div key={group.label} className={styles.group}>
              <div className={styles.groupLabel}>{group.label}</div>
              <table className={styles.table}>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.keys} className={styles.row}>
                      <td className={styles.keys}>
                        <Keys value={row.keys} />
                      </td>
                      <td className={styles.action}>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footer}>
        <DialogButton onClick={onClose} primary>Close</DialogButton>
      </div>
    </ModalDialog>
  )
}
