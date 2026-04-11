import React, { useRef, useEffect, useCallback, useState, useId } from 'react'
import type { RGBAColor } from '@/types'
import { SliderInput } from '@/components/SliderInput/SliderInput'
import styles from './ColorPicker.module.scss'

// ─── Color math ───────────────────────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h / 60) % 6
  const f = h / 60 - Math.floor(h / 60)
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  const table: [number, number, number][] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]
  ]
  const [r, g, b] = table[i]
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min
  const v = max, s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d + 6) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  return [h, s, v]
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ─── Canvas draw helpers ──────────────────────────────────────────────────────

function drawSvGradient(canvas: HTMLCanvasElement, hue: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width: w, height: h } = canvas
  ctx.fillStyle = `hsl(${hue}, 100%, 50%)`
  ctx.fillRect(0, 0, w, h)
  const wg = ctx.createLinearGradient(0, 0, w, 0)
  wg.addColorStop(0, 'rgba(255,255,255,1)')
  wg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = wg; ctx.fillRect(0, 0, w, h)
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, 'rgba(0,0,0,0)')
  bg.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h)
}

function drawHueStrip(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width: w, height: h } = canvas
  const g = ctx.createLinearGradient(0, 0, 0, h)
  for (let deg = 0; deg <= 360; deg += 30) g.addColorStop(deg / 360, `hsl(${deg},100%,50%)`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ColorPickerProps {
  primaryColor?: RGBAColor
  secondaryColor?: RGBAColor
  onPrimaryChange?: (color: RGBAColor) => void
  onSecondaryChange?: (color: RGBAColor) => void
}

export function ColorPicker({
  primaryColor = { r: 0, g: 0, b: 0, a: 255 },
  secondaryColor = { r: 255, g: 255, b: 255, a: 255 },
  onPrimaryChange,
  onSecondaryChange,
}: ColorPickerProps): React.JSX.Element {
  const gradRef = useRef<HTMLCanvasElement>(null)
  const hueRef = useRef<HTMLCanvasElement>(null)
  const hexId = useId()

  const init = rgbToHsv(primaryColor.r, primaryColor.g, primaryColor.b)
  const [hue, setHue] = useState(init[0])
  const [sat, setSat] = useState(init[1])
  const [val, setVal] = useState(init[2])
  const [active, setActive] = useState<'fg' | 'bg'>('fg')

  const fgHex = toHex(primaryColor.r, primaryColor.g, primaryColor.b)
  const bgHex = toHex(secondaryColor.r, secondaryColor.g, secondaryColor.b)
  const activeColor = active === 'fg' ? primaryColor : secondaryColor

  // ── Draw gradient square ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = gradRef.current
    if (!canvas) return
    drawSvGradient(canvas, hue)
    const ctx = canvas.getContext('2d')!
    const cx = sat * canvas.width
    const cy = (1 - val) * canvas.height
    ctx.save()
    ctx.strokeStyle = val > 0.55 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }, [hue, sat, val])

  // ── Draw hue strip ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = hueRef.current
    if (!canvas) return
    drawHueStrip(canvas)
    const ctx = canvas.getContext('2d')!
    const cy = (hue / 360) * canvas.height
    ctx.save()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 2
    ctx.strokeRect(1, cy - 3, canvas.width - 2, 6)
    ctx.restore()
  }, [hue])

  const fireColor = useCallback(
    (r: number, g: number, b: number): void => {
      const color: RGBAColor = { r, g, b, a: 255 }
      if (active === 'fg') onPrimaryChange?.(color)
      else onSecondaryChange?.(color)
    },
    [active, onPrimaryChange, onSecondaryChange]
  )

  const onGradPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId)
      if (e.buttons === 0) return
      const rect = e.currentTarget.getBoundingClientRect()
      const s = clamp((e.clientX - rect.left) / rect.width, 0, 1)
      const v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1)
      setSat(s); setVal(v)
      const [r, g, b] = hsvToRgb(hue, s, v)
      fireColor(r, g, b)
    },
    [hue, fireColor]
  )

  const onHuePointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId)
      if (e.buttons === 0) return
      const rect = e.currentTarget.getBoundingClientRect()
      const h = clamp((e.clientY - rect.top) / rect.height, 0, 1) * 360
      setHue(h)
      const [r, g, b] = hsvToRgb(h, sat, val)
      fireColor(r, g, b)
    },
    [sat, val, fireColor]
  )

  const onChannelChange = (ch: number, n: number): void => {
    const c = clamp(n, 0, 255)
    const nr = ch === 0 ? c : activeColor.r
    const ng = ch === 1 ? c : activeColor.g
    const nb = ch === 2 ? c : activeColor.b
    const [h, s, v] = rgbToHsv(nr, ng, nb)
    setHue(h); setSat(s); setVal(v)
    fireColor(nr, ng, nb)
  }

  const onHexChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const hex = e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const [h, s, v] = rgbToHsv(r, g, b)
      setHue(h); setSat(s); setVal(v)
      fireColor(r, g, b)
    }
  }

  return (
    <div className={styles.picker}>
      {/* FG / BG swatches */}
      <div className={styles.swatchRow}>
        <div className={styles.swatchStack}>
          <button
            className={`${styles.swatch} ${styles.swatchBack} ${active === 'bg' ? styles.swatchSel : ''}`}
            style={{ background: bgHex }}
            onClick={() => setActive('bg')}
            aria-label="Background color"
            title="Background (click to edit)"
          />
          <button
            className={`${styles.swatch} ${styles.swatchFront} ${active === 'fg' ? styles.swatchSel : ''}`}
            style={{ background: fgHex }}
            onClick={() => setActive('fg')}
            aria-label="Foreground color"
            title="Foreground (click to edit)"
          />
        </div>
        <span className={styles.swatchLabel}>{active === 'fg' ? 'Foreground' : 'Background'}</span>
      </div>

      {/* Gradient square + hue strip */}
      <div className={styles.gradientArea}>
        <canvas
          ref={gradRef}
          className={styles.gradCanvas}
          width={168}
          height={118}
          onPointerDown={onGradPointer}
          onPointerMove={onGradPointer}
        />
        <canvas
          ref={hueRef}
          className={styles.hueCanvas}
          width={14}
          height={118}
          onPointerDown={onHuePointer}
          onPointerMove={onHuePointer}
        />
      </div>

      {/* RGB channel sliders */}
      <div className={styles.channels}>
        {(['R', 'G', 'B'] as const).map((ch, i) => {
          const n = [activeColor.r, activeColor.g, activeColor.b][i]
          const endColors = ['#f00', '#0f0', '#00f']
          return (
            <div key={ch} className={styles.channelRow}>
              <span className={styles.chLabel}>{ch}</span>
              <input
                type="range" min={0} max={255} value={n}
                className={styles.chSlider}
                style={{ '--ch-end': endColors[i] } as React.CSSProperties}
                onChange={(e) => onChannelChange(i, parseInt(e.target.value))}
              />
              <SliderInput
                min={0}
                max={255}
                value={n}
                inputWidth={34}
                onChange={(v) => onChannelChange(i, v)}
              />
            </div>
          )
        })}
      </div>

      {/* Hex input */}
      <div className={styles.hexRow}>
        <label htmlFor={hexId} className={styles.hexLabel}>#</label>
        <input
          id={hexId}
          type="text"
          className={styles.hexInput}
          maxLength={6}
          defaultValue={(active === 'fg' ? fgHex : bgHex).slice(1)}
          key={active === 'fg' ? fgHex : bgHex}
          onChange={onHexChange}
          spellCheck={false}
        />
      </div>
    </div>
  )
}

