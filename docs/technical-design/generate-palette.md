# Technical Design: Generate Palette

## Overview

The Generate Palette dialog lets users replace their entire swatch collection in one step. It opens from a button in `SwatchPanel`, presents four generation modes (Color Wheel, Extract from Image, Device Emulation, Night Color), shows a live hue-sorted preview, and dispatches a single atomic `SET_SWATCHES` action on Apply. Because swatches are pure app state (not canvas pixel data), the undo integration requires extending `HistoryEntry` to carry a `swatches` snapshot alongside the existing layer data.

---

## Affected Areas

| File | Change |
|---|---|
| `src/store/AppContext.tsx` | Add `SET_SWATCHES` action type and reducer case |
| `src/store/historyStore.ts` | Add `swatches?: RGBAColor[]` to `HistoryEntry` |
| `src/hooks/useHistory.ts` | Persist `stateRef.current.swatches` in `captureHistory`; dispatch `SET_SWATCHES` in `onJumpTo` restore handler |
| `src/types/index.ts` | No changes — `RGBAColor` already covers all palette color values |
| `src/utils/paletteGenerators.ts` | **New file.** Pure TS: color wheel scheme generator + night color algorithm |
| `src/utils/devicePalettes.ts` | **New file.** Const arrays for all six canonical device palettes |
| `src/components/dialogs/GeneratePaletteDialog/GeneratePaletteDialog.tsx` | **New file.** Dialog component (four-mode UI, live preview, Apply / Cancel) |
| `src/components/dialogs/GeneratePaletteDialog/GeneratePaletteDialog.module.scss` | **New file.** Scoped styles for the dialog |
| `src/components/panels/Swatch/SwatchPanel.tsx` | Add `onGeneratePalette?: () => void` prop; wire existing button |
| `src/components/window/RightPanel/RightPanel.tsx` | Accept and thread `onGeneratePalette?: () => void` down to `SwatchPanel` |
| `src/App.tsx` | Add `showGeneratePaletteDialog` state; render `GeneratePaletteDialog`; pass `onGeneratePalette` to `RightPanel` |
| `src/components/index.ts` | Export `GeneratePaletteDialog` |

---

## State Changes

### New `AppAction` in `src/store/AppContext.tsx`

```ts
| { type: 'SET_SWATCHES'; payload: RGBAColor[] }
```

Reducer case:

```ts
case 'SET_SWATCHES':
  return { ...state, swatches: action.payload }
```

### Extended `HistoryEntry` in `src/store/historyStore.ts`

```ts
export interface HistoryEntry {
  // ... existing fields ...
  /** Swatch collection at the time of this snapshot. Optional so old entries are backward-compatible. */
  swatches?: RGBAColor[]
}
```

No changes to serialization or the `cloneHistoryEntry` helper are required — `RGBAColor[]` is a plain array of plain objects and clones correctly with `structuredClone` via the spread in `cloneHistoryEntry`.

---

## Algorithm Placement

### 1. Color Wheel — `src/utils/paletteGenerators.ts`

Pure TypeScript. No WASM, no React imports.

```ts
export type SchemeType =
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'tetradic'
  | 'split-complementary'

export interface ColorWheelOptions {
  baseHue: number        // 0–360
  scheme: SchemeType
  count: number          // ≥ 2
  saturation: number     // 0–1
  lightness: number      // 0–1
}

export function generateColorWheel(opts: ColorWheelOptions): RGBAColor[]
```

**Algorithm sketch:**
1. Derive the set of hue angles from `baseHue` and `scheme`:
   - Complementary: `[h, h+180]`
   - Analogous: `[h-30, h, h+30]`
   - Triadic: `[h, h+120, h+240]`
   - Tetradic: `[h, h+90, h+180, h+270]`
   - Split-Complementary: `[h, h+150, h+210]`
2. Distribute `count` colors across the derived hue angles, adding lightness steps within each hue family when more colors are requested than there are base angles.
3. Convert each (hue, saturation, lightness) triple to RGBA via the `hslToRgba` helper (add to this utility file alongside `rgbaToHsl` from `swatchSort.ts`).

### 2. Extract from Image — existing `quantize()` in `src/wasm/index.ts`

The existing `quantize()` wrapper (median-cut in RGB space, backed by `_pixelops_quantize`) is reused as the initial implementation. This avoids new C++ code and already handles the full WASM buffer lifecycle correctly.

**Deviation from spec:** The spec calls for k-means in CIELAB/OKLab space for more perceptually accurate extraction. Median-cut in RGB is an accepted pragmatic first step; upgrading to a true `_pixelops_kmeans_oklab` WASM function is left as a future improvement (see Open Questions).

**Pixel access inside the dialog:**

The dialog receives `canvasHandleRef` as a prop (matching the pattern of `GaussianBlurDialog` and other filter dialogs). On entering Extract mode — or whenever the color count changes — the dialog calls:

```ts
const result = await canvasHandleRef.current.rasterizeComposite('export')
const { palette, count } = await quantize(result.data, colorCount)
```

This composites all visible layers into a single flat RGBA buffer, then runs quantization. The async call is initiated inside a `useEffect` or event handler; a debounce of ~150 ms is applied to the count slider to avoid launching WASM for every tick.

`rasterizeComposite` requires an active document. Extract mode is disabled when the active tab has no canvas (`canvasHandleRef.current === null` or `tabs.length === 0`; see "Dialog component" below).

### 3. Device Emulation — `src/utils/devicePalettes.ts`

A plain TypeScript module exporting a `const` record of canonical palettes. No WASM, no React.

```ts
export type DevicePaletteKey = 'cga' | 'ega' | 'c64' | 'gameboy' | 'zxspectrum' | 'nes'

export const DEVICE_PALETTES: Record<DevicePaletteKey, RGBAColor[]>
```

Each entry is a hard-coded array of `RGBAColor` values matching the exact canonical values for that hardware. Preview update is synchronous — selecting a device immediately returns the fixed array.

### 4. Night Color — `src/utils/paletteGenerators.ts`

Pure TypeScript alongside the Color Wheel helpers.

```ts
export interface NightColorOptions {
  sourceSwatches: RGBAColor[]
  steps: number   // 2–4
}

export function generateNightColor(opts: NightColorOptions): RGBAColor[]
```

**Algorithm:**
1. For each source swatch, compute its HSL values.
2. Generate `steps` progressively darker, more desaturated variants by reducing `l` by an even fraction of the remaining lightness headroom and reducing `s` by ~15–20% per step.
3. Output: original swatch followed immediately by its `steps` variants (least to most muted). Final array length = `sourceSwatches.length * (1 + steps)`.

---

## New Components / Hooks / Tools

### `GeneratePaletteDialog` — `src/components/dialogs/GeneratePaletteDialog/GeneratePaletteDialog.tsx`

**Category:** Dialog (wraps `ModalDialog`, owns its own session state, dispatches `SET_SWATCHES` on Apply).

**Single responsibility:** Present the four-mode palette generation UI, compute a live preview, and dispatch the Apply action.

**Props:**

```ts
export interface GeneratePaletteDialogProps {
  open: boolean
  onClose: () => void
  /** Required to composite image pixels for Extract mode. */
  canvasHandleRef: { readonly current: CanvasHandle | null }
  /** Current swatch collection — passed in so Night Color has a source without reading AppContext. */
  swatches: RGBAColor[]
  /** True when at least one document tab with an active canvas is open. */
  hasActiveDocument: boolean
  /** Dispatch — used to fire SET_SWATCHES on Apply. */
  dispatch: Dispatch<AppAction>
  /** Push a history snapshot before mutating swatches so Apply is undoable. */
  captureHistory: (label: string) => void
}
```

**Internal state (all `useState`, session-local, reset on dialog open):**

```ts
type Mode = 'color-wheel' | 'extract' | 'device' | 'night-color'

// Shared
const [mode, setMode] = useState<Mode>('color-wheel')

// Color Wheel
const [baseHue, setBaseHue] = useState(0)
const [scheme, setScheme] = useState<SchemeType>('complementary')
const [colorCount, setColorCount] = useState(6)
const [saturation, setSaturation] = useState(0.8)
const [lightness, setLightness] = useState(0.5)

// Extract
const [extractCount, setExtractCount] = useState(16)
const [extractPalette, setExtractPalette] = useState<RGBAColor[]>([])
const [extractPending, setExtractPending] = useState(false)

// Device
const [deviceKey, setDeviceKey] = useState<DevicePaletteKey>('cga')

// Night Color
const [nightSteps, setNightSteps] = useState(3)
```

**Preview computation:**

- Color Wheel, Device, Night Color: `useMemo` over relevant state — synchronous, no async.
- Extract: a `useEffect` that fires when `mode === 'extract'` or `extractCount` changes. It calls `rasterizeComposite` + `quantize` and updates `extractPalette`. While pending, a spinner replaces the preview grid.

**Apply handler:**

```ts
function handleApply() {
  captureHistory('Generate Palette')
  dispatch({ type: 'SET_SWATCHES', payload: sortSwatchesByHue(preview) })
  onClose()
}
```

The preview is passed through `sortSwatchesByHue` so the stored order matches the panel display order.

**Disabled-mode tabs:**

- Extract tab is rendered with `disabled` / `aria-disabled` when `!hasActiveDocument`.
- Night Color tab is rendered with `disabled` / `aria-disabled` when `swatches.length === 0`.
- If the user is on a now-disabled mode (e.g. they close the last document), automatically switch to Color Wheel.

---

## Implementation Steps

1. **`src/store/AppContext.tsx`** — Add `| { type: 'SET_SWATCHES'; payload: RGBAColor[] }` to `AppAction`. Add the `case 'SET_SWATCHES': return { ...state, swatches: action.payload }` branch in `appReducer`.

2. **`src/store/historyStore.ts`** — Add `swatches?: RGBAColor[]` to the `HistoryEntry` interface. No changes to `cloneHistoryEntry` are needed.

3. **`src/hooks/useHistory.ts`** — In `captureHistory`, add `swatches: stateRef.current.swatches` to the object passed to `historyStore.push`. In the `onJumpTo` handler, after dispatching `RESTORE_LAYERS` or `SWITCH_TAB`, add:
   ```ts
   if (entry.swatches) {
     dispatch({ type: 'SET_SWATCHES', payload: entry.swatches })
   }
   ```

4. **`src/utils/paletteGenerators.ts`** — Create the file. Implement `hslToRgba`, `generateColorWheel`, and `generateNightColor` as described above.

5. **`src/utils/devicePalettes.ts`** — Create the file. Add all six `DEVICE_PALETTES` entries with exact canonical color values.

6. **`src/components/dialogs/GeneratePaletteDialog/GeneratePaletteDialog.tsx`** — Create the component. Structure:
   - `ModalDialog` shell (width ~560px)
   - Mode switcher tab row at the top (Color Wheel | Extract | Device | Night Color)
   - Mode body: conditional render of each mode's controls
   - Preview area below controls: `useMemo`/`useEffect`-driven grid of color chips, sorted via `sortSwatchesByHue`, wrapping in rows. Handle up to 256 chips.
   - Footer row: Apply button + Cancel button (use existing `DialogButton` widget pattern)

7. **`src/components/dialogs/GeneratePaletteDialog/GeneratePaletteDialog.module.scss`** — Create scoped styles. Use `.module.scss` (never plain `.scss`).

8. **`src/components/panels/Swatch/SwatchPanel.tsx`** — Change signature to `export function SwatchPanel({ onGeneratePalette }: { onGeneratePalette?: () => void })`. Replace the stub button's `onClick` with `onGeneratePalette?.()`. Remove the `// TODO` comment.

9. **`src/components/window/RightPanel/RightPanel.tsx`** — Add `onGeneratePalette?: () => void` to `RightPanelProps`. Thread it to `<SwatchPanel onGeneratePalette={onGeneratePalette} />`.

10. **`src/App.tsx`** — Add `const [showGeneratePaletteDialog, setShowGeneratePaletteDialog] = useState(false)`. Compute `hasActiveDocument`: `const hasActiveDocument = tabs.length > 0`. Pass `onGeneratePalette={() => setShowGeneratePaletteDialog(true)}` to `<RightPanel>`. Mount `<GeneratePaletteDialog>` alongside the other dialogs, passing `open={showGeneratePaletteDialog}`, `onClose`, `canvasHandleRef`, `swatches={state.swatches}`, `hasActiveDocument`, `dispatch`, and `captureHistory`.

11. **`src/components/index.ts`** — Add `export { GeneratePaletteDialog } from './dialogs/GeneratePaletteDialog/GeneratePaletteDialog'`.

---

## Architectural Constraints

**History system carries only layer pixel data today.** The current `HistoryEntry` stores no swatch state, so without step 2–3 above, Apply would not be undoable. The design extends `HistoryEntry` minimally (optional field, no migration burden) to satisfy the spec requirement.

**Dialog receives `canvasHandleRef` as a prop — not via context.** `canvasHandleRef` lives in `useTabs` (called from `App.tsx`) and is never placed in `AppContext`. All dialogs that need canvas access receive the ref as a prop from `App.tsx`. This is the established pattern (see `GaussianBlurDialog`, `AdjustmentPanel`).

**Extract mode must not bypass the rasterization pipeline.** Pixel access goes through `canvasHandleRef.current.rasterizeComposite('export')`, which runs the unified render plan. Direct GL layer reads would violate the rasterization pipeline rule and miss adjustment layers.

**`SET_SWATCHES` is the only dispatch on Apply.** The dialog must not call `ADD_SWATCH` / `REMOVE_SWATCH` in a loop — that would push multiple history entries, scatter re-renders, and make undo restore each color individually rather than atomically.

**Preview chip grid uses `sortSwatchesByHue`.** The same `sortSwatchesByHue` function used by `SwatchPanel` must drive the preview ordering so the preview matches what the panel will show after Apply.

**CSS modules only.** The new `.module.scss` file must be imported as `import styles from './GeneratePaletteDialog.module.scss'`.

---

## Open Questions

1. **WASM k-means in OKLab:** The spec calls for k-means in a perceptually uniform color space. The initial design reuses median-cut (existing `_pixelops_quantize`). Is this accepted for the first implementation, or must a new `_pixelops_kmeans_oklab` WASM function be built before ship? If the latter, the WASM work must be scoped: new `.h`/`.cpp`, `extern "C"` wrapper in `pixelops.cpp`, new entry in `CMakeLists.txt`, new TypeScript signature in `types.ts`, new `extractKMeans()` function in `wasm/index.ts`.

2. **History snapshot cost on large documents:** `captureHistory` reads all GPU layer pixels via `captureAllLayerPixels()`. Adding swatches to the entry is cheap (18–256 objects). No performance concern here, but confirm the team is comfortable with `captureHistory` always being called on Apply — even for a 100 MP document where the pixel snapshot is the expensive part.

3. **Default mode:** The spec says "defaults to one of the four modes." Recommend defaulting to **Color Wheel** since it requires no external input (no active document, non-empty swatches). Confirm with design.

4. **Extract on very large canvases:** `rasterizeComposite` returns a full-resolution RGBA buffer. For a 6000 × 4000 px document this is ~96 MB. Consider downsampling to a fixed max dimension (e.g. 512 px on the longest side) before passing to `quantize` to keep WASM memory usage bounded. This would be a local optimization inside the dialog's extract handler.

5. **`hslToRgba` duplication:** `swatchSort.ts` exposes `rgbaToHsl` but not the inverse. The new `paletteGenerators.ts` will add `hslToRgba`. Consider whether `rgbaToHsl` should be co-located in `paletteGenerators.ts` and re-exported from `swatchSort.ts` to avoid the near-duplicate, or left as a separate concern.
