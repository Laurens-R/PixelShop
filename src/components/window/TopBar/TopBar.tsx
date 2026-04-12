import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import styles from './TopBar.module.scss'

// ─── Menu definitions ─────────────────────────────────────────────────────────

interface MenuItemDef {
  label: string
  shortcut?: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
}
interface MenuDef {
  label: string
  items: MenuItemDef[]
}

// Static part of MENUS — File items are built inside the component so actions
// can close over props. The rest never change.
const STATIC_MENUS_TAIL: MenuDef[] = [
  {
    label: 'Edit',
    items: [
      { label: 'Undo', shortcut: 'Ctrl+Z' },
      { label: 'Redo', shortcut: 'Ctrl+Y' },
      { separator: true, label: '' },
      { label: 'Cut', shortcut: 'Ctrl+X' },
      { label: 'Copy', shortcut: 'Ctrl+C' },
      { label: 'Paste', shortcut: 'Ctrl+V' }
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
]


// ─── TopBar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  onNew?: () => void
  onOpen?: () => void
  onSave?: () => void
  onSaveAs?: () => void
  onExport?: () => void
}

export function TopBar({ onNew, onOpen, onSave, onSaveAs, onExport }: TopBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpenMenu(null), [])

  const menus = useMemo((): MenuDef[] => [
    {
      label: 'File',
      items: [
        { label: 'New…',       shortcut: 'Ctrl+N',       action: onNew },
        { label: 'Open\u2026',      shortcut: 'Ctrl+O',       action: onOpen },
        { separator: true, label: '' },
        { label: 'Save',           shortcut: 'Ctrl+S',       action: onSave },
        { label: 'Save As\u2026',  shortcut: 'Ctrl+Shift+S', action: onSaveAs },
        { label: 'Export As\u2026',shortcut: 'Ctrl+E',       action: onExport },
        { separator: true, label: '' },
        { label: 'Quit',           shortcut: 'Ctrl+Q' }
      ]
    },
    ...STATIC_MENUS_TAIL
  ], [onNew, onOpen, onSave, onSaveAs, onExport])

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [close])

  return (
    <div ref={barRef} className={styles.topBar}>
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

        {/* File/Edit/View menus */}
        {menus.map((menu) => (
          <div key={menu.label} className={styles.menuEntry}>
            <button
              className={`${styles.menuTrigger} ${openMenu === menu.label ? styles.menuOpen : ''}`}
              onClick={() => setOpenMenu((p) => (p === menu.label ? null : menu.label))}
              aria-haspopup="menu"
              aria-expanded={openMenu === menu.label}
            >
              {menu.label}
            </button>

            {openMenu === menu.label && (
              <ul className={styles.dropdown} role="menu">
                {menu.items.map((item, i) =>
                  item.separator ? (
                    <li key={i} role="separator" className={styles.dropSep} />
                  ) : (
                    <li key={item.label} role="none">
                      <button
                        className={styles.dropItem}
                        onClick={() => { item.action?.(); close() }}
                        role="menuitem"
                        disabled={item.disabled}
                      >
                        <span>{item.label}</span>
                        {item.shortcut && <kbd className={styles.dropKbd}>{item.shortcut}</kbd>}
                      </button>
                    </li>
                  )
                )}
              </ul>
            )}
          </div>
        ))}
      </div>


    </div>
  )
}
