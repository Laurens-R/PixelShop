import React, { useState, useRef, useEffect, useCallback } from 'react'
import styles from './TopBar.module.scss'

// ─── Menu definitions (same as old MenuBar, embedded here) ────────────────────

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

const MENUS: MenuDef[] = [
  {
    label: 'File',
    items: [
      { label: 'New…', shortcut: 'Ctrl+N' },
      { label: 'Open…', shortcut: 'Ctrl+O' },
      { separator: true, label: '' },
      { label: 'Save', shortcut: 'Ctrl+S' },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S' },
      { label: 'Export As…', shortcut: 'Ctrl+E' },
      { separator: true, label: '' },
      { label: 'Quit', shortcut: 'Ctrl+Q' }
    ]
  },
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

export function TopBar(): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpenMenu(null), [])

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
        {MENUS.map((menu) => (
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
