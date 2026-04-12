// ─── Clipboard store ──────────────────────────────────────────────────────────
// Module-level singleton holding the last copied/cut pixel data.
// Kept as raw RGBA so there's no encode/decode overhead on paste.

export interface ClipboardData {
  /** Full canvas-sized RGBA buffer. Unselected pixels have alpha=0. */
  data: Uint8Array
  width: number
  height: number
}

export const clipboardStore: { current: ClipboardData | null } = { current: null }
