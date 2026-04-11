import React from 'react'
import type { Tool } from '@/types'
import styles from './Toolbar.module.scss'

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const Icon = {
  move: (
    <svg viewBox="0 0 14 14" fill="currentColor">
      <polygon points="7,1 5.5,3.5 6.3,3.5 6.3,6.3 3.5,6.3 3.5,5.5 1,7 3.5,8.5 3.5,7.7 6.3,7.7 6.3,10.5 5.5,10.5 7,13 8.5,10.5 7.7,10.5 7.7,7.7 10.5,7.7 10.5,8.5 13,7 10.5,5.5 10.5,6.3 7.7,6.3 7.7,3.5 8.5,3.5" />
    </svg>
  ),
  select: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="10" height="10" rx="0.5" strokeDasharray="2 1.5" />
    </svg>
  ),
  lasso: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M7 2C3.5 2 1.5 4 1.5 6.5 1.5 9 3.5 11 7 11c3 0 4-1.5 4-3s-1.5-2.5-3-2.5-2 1-2 2" strokeDasharray="2 1.5" />
      <path d="M9.5 10.5L5 13 4 12l5-2.5" strokeDasharray="none" />
    </svg>
  ),
  magicWand: (
    <svg viewBox="0 0 14 14" fill="currentColor">
      <rect x="1" y="10.5" width="8" height="1.4" rx="0.7" transform="rotate(-45 5 11.2)" />
      <circle cx="8" cy="3.5" r="0.8" />
      <circle cx="10.5" cy="5" r="0.8" />
      <circle cx="6" cy="1.5" r="0.8" />
      <circle cx="11.5" cy="2.5" r="0.8" />
      <circle cx="12" cy="7" r="0.8" />
      <path d="M8 3.5L12 7M10.5 5L8 3.5M6 1.5L8 3.5" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  ),
  crop: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 1v9h9" />
      <path d="M1 3h9v9" />
    </svg>
  ),
  frame: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="10" height="10" rx="1" />
      <rect x="4" y="4" width="6" height="6" rx="0.5" />
    </svg>
  ),
  eyedropper: (
    <svg viewBox="0 0 14 14" fill="currentColor">
      <rect x="5.5" y="1.5" width="3" height="7" rx="1.5" transform="rotate(45 7 5)" />
      <circle cx="4" cy="10" r="1.8" />
    </svg>
  ),
  pencil: (
    <svg viewBox="0 0 14 14" fill="currentColor">
      <path d="M10.5 1.5L12.5 3.5 4.5 11.5 2 12 2.5 9.5z" />
      <path d="M9 3L11 5" stroke="currentColor" strokeWidth="0.8" fill="none" />
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 14 14" fill="currentColor">
      <path d="M11.5 1.5L12.5 2.5 5 10l-1.5.5.5-1.5z" />
      <ellipse cx="4" cy="11.5" rx="1.8" ry="1" transform="rotate(-45 4 11.5)" />
    </svg>
  ),
  eraser: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 11L8.5 4.5l3 3-4.5 4.5H2z" fill="currentColor" fillOpacity="0.3" />
      <path d="M2 11h10" strokeLinecap="round" />
      <path d="M8.5 4.5l3 3" />
    </svg>
  ),
  fill: (
    <svg viewBox="0 0 14 14" fill="currentColor">
      <path d="M2 11L6.5 2l1.5 1-3 7.5z" />
      <path d="M6 8.5l5-5 1.5 1.5-5 5-2 .5z" />
      <path d="M11 11.5a1.5 1.5 0 002.5-1 4 4 0 00-.8-2l-1.7 3z" />
    </svg>
  ),
  gradient: (
    <svg viewBox="0 0 14 14">
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect x="2" y="5" width="10" height="4" fill="url(#grad)" rx="1" />
    </svg>
  ),
  dodge: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <ellipse cx="7" cy="9" rx="4" ry="2.5" />
      <line x1="7" y1="6.5" x2="7" y2="1.5" strokeLinecap="round" />
    </svg>
  ),
  burn: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M7 2C5 4 3.5 5.5 3.5 7.5a3.5 3.5 0 007 0C10.5 5.5 9 4 7 2z" />
      <path d="M7 2C7 5 9 6 7.5 8.5" strokeLinecap="round" />
    </svg>
  ),
  text: (
    <svg viewBox="0 0 14 14" fill="currentColor">
      <text x="3" y="11" fontSize="10" fontFamily="serif" fontWeight="bold">T</text>
    </svg>
  ),
  shape: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="4.5" height="4.5" rx="0.5" />
      <ellipse cx="9.5" cy="4.5" rx="2.5" ry="2.5" />
      <polygon points="7,9 13,9 10,13" />
    </svg>
  ),
  hand: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M5 9V4a1 1 0 012 0v0a1 1 0 012 0V5a1 1 0 012 0v2.5A4.5 4.5 0 017 12H6A4 4 0 012 8V7a1 1 0 012 0v2" />
    </svg>
  ),
  zoom: (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="6" cy="6" r="4" />
      <line x1="9" y1="9" x2="12.5" y2="12.5" />
      <line x1="4.5" y1="6" x2="7.5" y2="6" />
      <line x1="6" y1="4.5" x2="6" y2="7.5" />
    </svg>
  )
}

// ─── Tool groups ──────────────────────────────────────────────────────────────

interface ToolDef {
  id: Tool
  label: string
  shortcut: string
  icon: React.JSX.Element
}

type ToolGrid = (ToolDef | null)[][]

const TOOL_GRID: ToolGrid = [
  // group 1
  [
    { id: 'move',       label: 'Move',          shortcut: 'V', icon: Icon.move },
    null
  ],
  // group 2 – selection
  [
    { id: 'select',     label: 'Marquee',       shortcut: 'M', icon: Icon.select },
    { id: 'lasso',      label: 'Lasso',         shortcut: 'L', icon: Icon.lasso }
  ],
  [
    { id: 'magic-wand', label: 'Magic Wand',    shortcut: 'W', icon: Icon.magicWand },
    { id: 'crop',       label: 'Crop',          shortcut: 'C', icon: Icon.crop }
  ],
  // group 3 – sampling
  [
    { id: 'eyedropper', label: 'Eyedropper',    shortcut: 'I', icon: Icon.eyedropper },
    { id: 'frame',      label: 'Frame',         shortcut: 'K', icon: Icon.frame }
  ],
  // group 4 – painting
  [
    { id: 'brush',      label: 'Brush',         shortcut: 'B', icon: Icon.brush },
    { id: 'pencil',     label: 'Pencil',        shortcut: 'N', icon: Icon.pencil }
  ],
  [
    { id: 'eraser',     label: 'Eraser',        shortcut: 'E', icon: Icon.eraser },
    null
  ],
  // group 5 – fills
  [
    { id: 'fill',       label: 'Paint Bucket',  shortcut: 'G', icon: Icon.fill },
    { id: 'gradient',   label: 'Gradient',      shortcut: 'G', icon: Icon.gradient }
  ],
  // group 6 – toning
  [
    { id: 'dodge',      label: 'Dodge',         shortcut: 'O', icon: Icon.dodge },
    { id: 'burn',       label: 'Burn',          shortcut: 'O', icon: Icon.burn }
  ],
  // group 7 – vector
  [
    { id: 'text',       label: 'Type',          shortcut: 'T', icon: Icon.text },
    { id: 'shape',      label: 'Shape',         shortcut: 'U', icon: Icon.shape }
  ],
  // group 8 – navigation
  [
    { id: 'hand',       label: 'Hand',          shortcut: 'H', icon: Icon.hand },
    { id: 'zoom',       label: 'Zoom',          shortcut: 'Z', icon: Icon.zoom }
  ]
]

// ─── Component ────────────────────────────────────────────────────────────────

interface ToolbarProps {
  activeTool?: Tool
  onToolChange?: (tool: Tool) => void
}

export function Toolbar({ activeTool = 'pencil', onToolChange }: ToolbarProps): React.JSX.Element {
  return (
    <nav className={styles.toolbar} aria-label="Drawing tools">
      <ul className={styles.grid} role="list">
        {TOOL_GRID.map((row, rowIdx) => {
          const isFirstInGroup =
            rowIdx === 0 ||
            (rowIdx === 1) || (rowIdx === 3) || (rowIdx === 4) || (rowIdx === 6) || (rowIdx === 7) || (rowIdx === 8) || (rowIdx === 9)

          return (
            <React.Fragment key={rowIdx}>
              {isFirstInGroup && rowIdx !== 0 && (
                <li className={styles.separator} aria-hidden="true" />
              )}
              <li className={styles.row}>
                {row.map((tool, colIdx) =>
                  tool ? (
                    <button
                      key={tool.id}
                      className={`${styles.toolBtn} ${activeTool === tool.id ? styles.active : ''}`}
                      onClick={() => onToolChange?.(tool.id)}
                      aria-label={`${tool.label}  (${tool.shortcut})`}
                      aria-pressed={activeTool === tool.id}
                      title={`${tool.label}  ${tool.shortcut}`}
                    >
                      {tool.icon}
                    </button>
                  ) : (
                    <div key={`empty-${colIdx}`} className={styles.emptyCell} aria-hidden="true" />
                  )
                )}
              </li>
            </React.Fragment>
          )
        })}
      </ul>

      {/* ── Foreground / Background color swatches ───────────────────── */}
      <div className={styles.swatches}>
        <div className={styles.swatchBg} title="Background color" />
        <div className={styles.swatchFg} title="Foreground color" />
        <button className={styles.swatchReset} title="Reset to Default (D)" aria-label="Reset colors to default" />
        <button className={styles.swatchSwap} title="Swap Colors (X)" aria-label="Swap foreground/background">
          <svg viewBox="0 0 10 10" fill="currentColor" width="9" height="9">
            <path d="M6.5 1L9 3.5 6.5 6V4.5H2V3h4.5zM3.5 9L1 6.5 3.5 4v1.5H8V7H3.5z" />
          </svg>
        </button>
      </div>
    </nav>
  )
}

