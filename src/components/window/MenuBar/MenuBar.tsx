import React, { useState, useRef, useEffect, useCallback } from 'react'
import styles from './MenuBar.module.scss'

export interface MenuItemDef {
  label: string
  shortcut?: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
}

export interface MenuDef {
  label: string
  items: MenuItemDef[]
}

const DEFAULT_MENUS: MenuDef[] = [
  {
    label: 'File',
    items: [
      { label: 'New', shortcut: 'Ctrl+N' },
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
      { label: 'Show Grid', shortcut: 'Ctrl+G' },
      { label: 'Show Rulers' }
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
    items: [{ label: 'About PixelShop' }, { label: 'Keyboard Shortcuts', shortcut: '?' }]
  }
]

interface MenuBarProps {
  menus?: MenuDef[]
}

export function MenuBar({ menus = DEFAULT_MENUS }: MenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)

  const close = useCallback(() => setOpenMenu(null), [])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        close()
      }
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close])

  const handleTrigger = (label: string): void => {
    setOpenMenu((prev) => (prev === label ? null : label))
  }

  const handleMouseEnter = (label: string): void => {
    if (openMenu !== null && openMenu !== label) {
      setOpenMenu(label)
    }
  }

  const handleItemClick = (item: MenuItemDef): void => {
    if (item.disabled || item.separator) return
    item.action?.()
    close()
  }

  return (
    <nav ref={navRef} className={styles.menuBar} aria-label="Application menu">
      {menus.map((menu) => (
        <div key={menu.label} className={styles.entry}>
          <button
            className={`${styles.trigger} ${openMenu === menu.label ? styles.open : ''}`}
            onClick={() => handleTrigger(menu.label)}
            onMouseEnter={() => handleMouseEnter(menu.label)}
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.label}
          >
            {menu.label}
          </button>

          {openMenu === menu.label && (
            <ul className={styles.dropdown} role="menu">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <li key={i} role="separator" className={styles.separator} />
                ) : (
                  <li key={item.label} role="none">
                    <button
                      className={styles.menuItem}
                      onClick={() => handleItemClick(item)}
                      role="menuitem"
                      disabled={item.disabled}
                    >
                      <span className={styles.itemLabel}>{item.label}</span>
                      {item.shortcut && (
                        <span className={styles.shortcut}>{item.shortcut}</span>
                      )}
                    </button>
                  </li>
                )
              )}
            </ul>
          )}
        </div>
      ))}
    </nav>
  )
}
