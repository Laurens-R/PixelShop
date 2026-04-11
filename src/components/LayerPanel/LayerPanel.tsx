import React from 'react'
import type { LayerState } from '@/types'
import styles from './LayerPanel.module.scss'

// ─── Icons ────────────────────────────────────────────────────────────────────

const EyeIcon = ({ visible }: { visible: boolean }): React.JSX.Element =>
  visible ? (
    <svg viewBox="0 0 14 14" fill="currentColor" width="12" height="12">
      <path d="M7 2C4 2 1.5 5 1.5 7S4 12 7 12s5.5-3 5.5-5S10 2 7 2zm0 8a3 3 0 110-6 3 3 0 010 6z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" width="12" height="12">
      <path d="M2 2l10 10M5.5 4.2A5.5 5.5 0 017 4c3 0 5 2.5 5.5 3-.4.7-1.3 1.8-2.5 2.5M3 5.5C2 6.2 1.5 6.8 1.5 7c.5.5 2.5 3 5.5 3 .6 0 1.2-.1 1.7-.3" strokeLinecap="round" />
    </svg>
  )

const LockIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 12 14" fill="currentColor" width="10" height="12">
    <rect x="2" y="6" width="8" height="7" rx="1" />
    <path d="M4 6V4.5a2 2 0 114 0V6" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

const AddLayerIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" width="12" height="12">
    <rect x="2" y="4" width="8" height="8" rx="1" />
    <path d="M5 2h6a1 1 0 011 1v6" strokeLinecap="round" />
    <path d="M6 8h4M8 6v4" strokeLinecap="round" />
  </svg>
)

const DeleteLayerIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" width="12" height="12">
    <path d="M3 4h8M5 4V3h4v1M5 4v7h4V4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface LayerPanelProps {
  layers?: LayerState[]
  activeLayerId?: string
  onActiveLayerChange?: (id: string) => void
  onLayerAdd?: () => void
  onLayerDelete?: (id: string) => void
  onLayerToggleVisibility?: (id: string) => void
  onLayerOpacityChange?: (id: string, opacity: number) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LayerPanel({
  layers = [],
  activeLayerId,
  onActiveLayerChange,
  onLayerAdd,
  onLayerDelete,
  onLayerToggleVisibility,
  onLayerOpacityChange: _onLayerOpacityChange
}: LayerPanelProps): React.JSX.Element {
  const canDelete = layers.length > 1
  const displayLayers = [...layers].reverse()

  return (
    <div className={styles.panel}>
      {/* ── Filter / search row ───────────────────────────────────────── */}
      <div className={styles.filterRow}>
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" width="11" height="11" className={styles.searchIcon}>
          <circle cx="5" cy="5" r="3.5" />
          <line x1="7.5" y1="7.5" x2="11" y2="11" strokeLinecap="round" />
        </svg>
        <select className={styles.kindSelect}>
          <option>Kind</option>
          <option>Name</option>
          <option>Effect</option>
          <option>Mode</option>
          <option>Attribute</option>
          <option>Color</option>
        </select>
        <div className={styles.filterIcons}>
          {/* pixel / adjustment / type / shape / smart icons */}
          {['⬜', 'A', 'T', '⬟', '☁'].map((ic, i) => (
            <button key={i} className={styles.filterIcon} title="Filter by type">
              <span>{ic}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Blend mode + Opacity ──────────────────────────────────────── */}
      <div className={styles.blendRow}>
        <select className={styles.blendSelect}>
          <option>Normal</option>
          <option>Multiply</option>
          <option>Screen</option>
          <option>Overlay</option>
          <option>Soft Light</option>
          <option>Hard Light</option>
          <option>Dissolve</option>
          <option>Darken</option>
          <option>Lighten</option>
          <option>Difference</option>
        </select>
        <label className={styles.numLabel}>Opacity:</label>
        <div className={styles.numField}>
          <input
            type="number"
            className={styles.numInput}
            min={0} max={100}
            defaultValue={100}
          />
          <span className={styles.numSuffix}>%</span>
        </div>
      </div>

      {/* ── Lock icons + Fill ─────────────────────────────────────────── */}
      <div className={styles.lockRow}>
        <span className={styles.lockLabel}>Lock:</span>
        <button className={styles.lockBtn} title="Lock transparent pixels">
          <svg viewBox="0 0 10 12" fill="currentColor" width="9" height="11">
            <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3.5 4.5L4.5 5.5 6.5 3.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        <button className={styles.lockBtn} title="Lock image pixels">
          <svg viewBox="0 0 12 12" fill="currentColor" width="10" height="10">
            <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="6" cy="6" r="1.5" />
          </svg>
        </button>
        <button className={styles.lockBtn} title="Lock position">
          <svg viewBox="0 0 12 14" fill="currentColor" width="10" height="11">
            <rect x="2" y="6" width="8" height="7" rx="1" />
            <path d="M4 6V4.5a2 2 0 114 0V6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
        <button className={styles.lockBtn} title="Lock all">
          <svg viewBox="0 0 12 14" fill="currentColor" width="10" height="11">
            <rect x="2" y="6" width="8" height="7" rx="1" />
            <path d="M4 6V4.5a2 2 0 114 0V6" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4 9h4" stroke="#fff" strokeWidth="1" />
          </svg>
        </button>
        <div className={styles.lockSpacer} />
        <label className={styles.numLabel}>Fill:</label>
        <div className={styles.numField}>
          <input
            type="number"
            className={styles.numInput}
            min={0} max={100}
            defaultValue={100}
          />
          <span className={styles.numSuffix}>%</span>
        </div>
      </div>

      {/* ── Layer list ────────────────────────────────────────────────── */}
      <ul className={styles.list} role="listbox" aria-label="Layers">
        {displayLayers.map((layer) => {
          const isActive = layer.id === activeLayerId
          return (
            <li
              key={layer.id}
              className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
              role="option"
              aria-selected={isActive}
              onClick={() => onActiveLayerChange?.(layer.id)}
            >
              {/* Eye */}
              <button
                className={styles.eyeBtn}
                onClick={(e) => { e.stopPropagation(); onLayerToggleVisibility?.(layer.id) }}
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                <EyeIcon visible={layer.visible} />
              </button>

              {/* Thumbnail */}
              <div className={styles.thumb} aria-hidden="true" />

              {/* Name */}
              <span className={styles.name}>{layer.name}</span>

              {/* Lock icon (if locked) */}
              {layer.locked && (
                <span className={styles.lockIcon}><LockIcon /></span>
              )}
            </li>
          )
        })}
      </ul>

      {/* ── Bottom toolbar ────────────────────────────────────────────── */}
      <div className={styles.footer}>
        {[
          'fx',
          <svg key="mask" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" width="10" height="10"><circle cx="4" cy="6" r="3" /><rect x="5" y="3" width="6" height="6" rx="1" /></svg>,
          <svg key="adj" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" width="10" height="10"><circle cx="6" cy="6" r="5" /><path d="M6 1v11M1 6h10" /></svg>,
          <span key="grp" style={{ fontSize: 12 }}>⊞</span>
        ].map((icon, i) => (
          <button key={i} className={styles.footerBtn} aria-label="Layer action">
            {typeof icon === 'string' ? <span className={styles.fxLabel}>{icon}</span> : icon}
          </button>
        ))}
        <div className={styles.footerSpacer} />
        <button
          className={styles.footerBtn}
          onClick={onLayerAdd}
          aria-label="New layer"
          title="New layer"
        >
          <AddLayerIcon />
        </button>
        <button
          className={styles.footerBtn}
          onClick={() => activeLayerId && onLayerDelete?.(activeLayerId)}
          aria-label="Delete layer"
          title="Delete layer"
          disabled={!canDelete}
        >
          <DeleteLayerIcon />
        </button>
      </div>
    </div>
  )
}
