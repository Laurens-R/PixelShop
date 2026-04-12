import React, { useMemo } from 'react'
import { MenuBar } from '../MenuBar/MenuBar'
import type { MenuDef } from '../MenuBar/MenuBar'
import styles from './TopBar.module.scss'


// ─── TopBar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  onDebug?: () => void
  onNew?: () => void
  onOpen?: () => void
  onSave?: () => void
  onSaveAs?: () => void
  onExport?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onCut?: () => void
  onCopy?: () => void
  onPaste?: () => void
  onDelete?: () => void
  onResizeImage?: () => void
  onResizeCanvas?: () => void
}

export function TopBar({ onDebug, onNew, onOpen, onSave, onSaveAs, onExport, onUndo, onRedo, onCut, onCopy, onPaste, onDelete, onResizeImage, onResizeCanvas }: TopBarProps): React.JSX.Element {
  const menus = useMemo((): MenuDef[] => [
    {
      label: 'File',
      items: [
        { label: 'New…',        shortcut: 'Ctrl+N',       action: onNew },
        { label: 'Open…',       shortcut: 'Ctrl+O',       action: onOpen },
        { separator: true, label: '' },
        { label: 'Save',           shortcut: 'Ctrl+S',       action: onSave },
        { label: 'Save As…',    shortcut: 'Ctrl+Shift+S', action: onSaveAs },
        { label: 'Export As…',  shortcut: 'Ctrl+E',       action: onExport },
        { separator: true, label: '' },
        { label: 'Quit',           shortcut: 'Ctrl+Q' }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: onUndo },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: onRedo },
        { separator: true, label: '' },
        { label: 'Cut',    shortcut: 'Ctrl+X', action: onCut },
        { label: 'Copy',   shortcut: 'Ctrl+C', action: onCopy },
        { label: 'Paste',  shortcut: 'Ctrl+V', action: onPaste },
        { label: 'Delete', shortcut: 'Del',    action: onDelete },
        { separator: true, label: '' },
        { label: 'Resize Image…',        action: onResizeImage },
        { label: 'Resize Image Canvas…', action: onResizeCanvas },
      ]
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', shortcut: 'Ctrl+=' },
        { label: 'Zoom Out', shortcut: 'Ctrl+-' },
        { label: 'Fit to Window', shortcut: 'Ctrl+0' },
        { separator: true, label: '' },
        { label: 'Show Grid', shortcut: 'Ctrl+G' }
      ]
    },
    {
      label: 'Layer',
      items: [
        { label: 'New Layer', shortcut: 'Ctrl+Shift+N' },
        { label: 'Duplicate Layer' },
        { label: 'Delete Layer' },
        { separator: true, label: '' },
        { label: 'Merge Down' },
        { label: 'Flatten Image' }
      ]
    },
    {
      label: 'Help',
      items: [{ label: 'About PixelShop' }, { label: 'Keyboard Shortcuts' }]
    }
  ], [onNew, onOpen, onSave, onSaveAs, onExport, onUndo, onRedo, onCut, onCopy, onPaste, onDelete, onResizeImage, onResizeCanvas])

  return (
    <div className={styles.topBar}>
      {/* Left: Logo + menus */}
      <div className={styles.left}>
        {/* PS-style home/logo icon */}
        <button className={styles.logoBtn} aria-label="PixelShop home" title="PixelShop">
          <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>

        <div className={styles.menuDivider} />

        <MenuBar menus={menus} />
      </div>

      {/* Right: debug button */}
      <div className={styles.right}>
        <button
          className={styles.debugBtn}
          onClick={onDebug}
          title="Open DevTools"
          aria-label="Open DevTools"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
            <polyline points="4,6 1,8 4,10" />
            <polyline points="12,6 15,8 12,10" />
            <line x1="9" y1="3" x2="7" y2="13" />
          </svg>
        </button>
      </div>
    </div>
  )
}
