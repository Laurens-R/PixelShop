import React, { useMemo } from 'react'
import { MenuBar } from '../MenuBar/MenuBar'
import type { MenuDef } from '../MenuBar/MenuBar'
import styles from './TopBar.module.scss'


// ─── TopBar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  onNew?: () => void
  onOpen?: () => void
  onSave?: () => void
  onSaveAs?: () => void
  onExport?: () => void
  onCut?: () => void
  onCopy?: () => void
  onPaste?: () => void
}

export function TopBar({ onNew, onOpen, onSave, onSaveAs, onExport, onCut, onCopy, onPaste }: TopBarProps): React.JSX.Element {
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
        { label: 'Undo', shortcut: 'Ctrl+Z' },
        { label: 'Redo', shortcut: 'Ctrl+Y' },
        { separator: true, label: '' },
        { label: 'Cut',   shortcut: 'Ctrl+X', action: onCut },
        { label: 'Copy',  shortcut: 'Ctrl+C', action: onCopy },
        { label: 'Paste', shortcut: 'Ctrl+V', action: onPaste }
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
  ], [onNew, onOpen, onSave, onSaveAs, onExport, onCut, onCopy, onPaste])

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


    </div>
  )
}
