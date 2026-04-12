import React, { useState, useEffect, useCallback } from 'react'
import { DialogButton } from '../../widgets/DialogButton/DialogButton'
import { ModalDialog } from '../ModalDialog/ModalDialog'
import styles from './ExportDialog.module.scss'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExportFormat = 'png' | 'jpeg' | 'webp'

export interface ExportSettings {
  filePath: string
  format: ExportFormat
  jpegQuality: number      // 0–100
  jpegBackground: string   // CSS hex colour
  webpQuality: number      // 0–100
}

export interface ExportDialogProps {
  open: boolean
  onConfirm: (settings: ExportSettings) => void
  onCancel: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Replace or append the correct extension based on the chosen format. */
function applyExtension(filePath: string, format: ExportFormat): string {
  if (!filePath) return filePath
  const ext = format === 'png' ? '.png' : format === 'webp' ? '.webp' : '.jpg'
  return filePath.replace(/\.(png|jpe?g|webp)$/i, '') + ext
}

/** Convert a CSS hex colour (#rrggbb) to the format expected by <input type="color">. */
function toColorInputValue(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '#ffffff'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExportDialog({ open, onConfirm, onCancel }: ExportDialogProps): React.JSX.Element | null {
  const [filePath, setFilePath]       = useState('')
  const [format, setFormat]           = useState<ExportFormat>('png')
  const [jpegQuality, setJpegQuality] = useState(92)
  const [jpegBg, setJpegBg]           = useState('#ffffff')
  const [webpQuality, setWebpQuality] = useState(90)

  // Reset state on every open
  useEffect(() => {
    if (open) {
      setFilePath('')
      setFormat('png')
      setJpegQuality(92)
      setJpegBg('#ffffff')
      setWebpQuality(90)
    }
  }, [open])

  // When format changes, update the extension on the stored path.
  const handleFormatChange = useCallback((fmt: ExportFormat): void => {
    setFormat(fmt)
    setFilePath((p) => applyExtension(p, fmt))
  }, [])

  // Native browse dialog
  const handleBrowse = useCallback(async (): Promise<void> => {
    const chosen = await window.api.exportBrowse(format)
    if (chosen) setFilePath(chosen)
  }, [format])

  const handleConfirm = useCallback((): void => {
    if (!filePath.trim()) return
    onConfirm({
      filePath: filePath.trim(),
      format,
      jpegQuality: Math.max(1, Math.min(100, Math.round(jpegQuality))),
      jpegBackground: jpegBg,
      webpQuality: Math.max(1, Math.min(100, Math.round(webpQuality))),
    })
  }, [filePath, format, jpegQuality, jpegBg, onConfirm])

  // Keyboard: Enter = confirm (Escape handled by ModalDialog)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') { e.stopPropagation(); handleConfirm() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, handleConfirm])

  const canExport = filePath.trim().length > 0

  return (
    <ModalDialog open={open} title="Export As" width={440} onClose={onCancel}>

        {/* ── Body ──────────────────────────────────────────────── */}
        <div className={styles.body}>
          <p className={styles.sectionTitle}>EXPORT SETTINGS</p>

          {/* Filename */}
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="ex-path">File</label>
            <input
              id="ex-path"
              type="text"
              className={styles.textInput}
              value={filePath}
              placeholder="Choose a file path…"
              onChange={(e) => setFilePath(e.target.value)}
            />
            <DialogButton onClick={handleBrowse} className={styles.browseBtn}>Browse…</DialogButton>
          </div>

          {/* Format */}
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="ex-format">Format</label>
            <select
              id="ex-format"
              className={styles.select}
              value={format}
              onChange={(e) => handleFormatChange(e.target.value as ExportFormat)}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>

          {/* Per-format options */}
          <div className={styles.optionsDivider} />

          <div className={styles.optionsSection}>
            {format === 'png' && (
              <>
                <p className={styles.sectionTitle}>PNG OPTIONS</p>
                <div className={styles.fieldRow}>
                  <label className={styles.fieldLabel}>Compression</label>
                  <span className={styles.staticNote}>
                    Lossless — automatically optimised by the browser
                  </span>
                </div>
              </>
            )}

            {format === 'jpeg' && (
              <>
                <p className={styles.sectionTitle}>JPEG OPTIONS</p>

                {/* Quality */}
                <div className={styles.fieldRow}>
                  <label className={styles.fieldLabel} htmlFor="ex-quality">Quality</label>
                  <div className={styles.sliderGroup}>
                    <input
                      id="ex-quality"
                      type="range"
                      className={styles.slider}
                      min={1}
                      max={100}
                      value={jpegQuality}
                      onChange={(e) => setJpegQuality(e.target.valueAsNumber)}
                    />
                    <input
                      type="number"
                      className={styles.sliderValue}
                      min={1}
                      max={100}
                      value={jpegQuality}
                      onChange={(e) => {
                        const v = e.target.valueAsNumber
                        if (!isNaN(v)) setJpegQuality(Math.max(1, Math.min(100, v)))
                      }}
                    />
                  </div>
                </div>

                {/* Background colour for transparent pixels */}
                <div className={styles.fieldRow}>
                  <label className={styles.fieldLabel} htmlFor="ex-bg">Background</label>
                  <div className={styles.colorInputWrapper}>
                    <label className={styles.colorSwatch} title="Pick background colour">
                      <input
                        type="color"
                        value={toColorInputValue(jpegBg)}
                        onChange={(e) => setJpegBg(e.target.value)}
                      />
                      <span className={styles.srOnly}>Background colour picker</span>
                    </label>
                    <input
                      id="ex-bg"
                      type="text"
                      className={styles.colorHex}
                      value={jpegBg}
                      maxLength={7}
                      onChange={(e) => {
                        const v = e.target.value
                        setJpegBg(v)
                      }}
                      onBlur={(e) => {
                        const v = e.target.value
                        if (!/^#[0-9a-f]{6}$/i.test(v)) setJpegBg('#ffffff')
                      }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted, #7a7a7a)' }}>
                      for transparency
                    </span>
                  </div>
                </div>
              </>
            )}

            {format === 'webp' && (
              <>
                <p className={styles.sectionTitle}>WEBP OPTIONS</p>
                <div className={styles.fieldRow}>
                  <label className={styles.fieldLabel} htmlFor="ex-wquality">Quality</label>
                  <div className={styles.sliderGroup}>
                    <input
                      id="ex-wquality"
                      type="range"
                      className={styles.slider}
                      min={1}
                      max={100}
                      value={webpQuality}
                      onChange={(e) => setWebpQuality(e.target.valueAsNumber)}
                    />
                    <input
                      type="number"
                      className={styles.sliderValue}
                      min={1}
                      max={100}
                      value={webpQuality}
                      onChange={(e) => {
                        const v = e.target.valueAsNumber
                        if (!isNaN(v)) setWebpQuality(Math.max(1, Math.min(100, v)))
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Footer ────────────────────────────────────────────── */}
        <div className={styles.footer}>
          <DialogButton onClick={onCancel}>Cancel</DialogButton>
          <DialogButton onClick={handleConfirm} primary title={canExport ? undefined : 'Choose a file path first'}>
            Export
          </DialogButton>
        </div>

    </ModalDialog>
  )
}
