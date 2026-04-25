# Adding a New Tool

This guide walks through everything required to add a new drawing or selection tool. We'll build a hypothetical **Smudge** tool as the running example — a tool that blurs pixels under the cursor in the direction of movement.

---

## How tools work

Before writing any code, understand the data flow:

```
User pointer event (mouse/pen/touch)
  ↓
Canvas.tsx captures it (React onPointerDown/Move/Up)
  ↓
Builds a ToolContext with renderer, active GpuLayer, colors, etc.
  ↓
Calls toolHandlerRef.current.onPointerDown(pos, ctx)
  ↓
Tool handler reads/writes layer.data (CPU-side Uint8Array)
  ↓
Calls renderer.flushLayer(layer)  → uploads to GPU texture
  ↓
Calls ctx.render(layers)  → WebGPU composites all layers to screen
  ↓
On stroke end: calls ctx.commitStroke('Label')  → captureHistory
```

**There is no React state in a tool handler.** Tools are plain objects. They read options from a module-level object (which is always fresh) and read pixel data from the `GpuLayer` they receive via `ToolContext`.

---

## Step 1: Add the tool name to the `Tool` union

Open `src/types/index.ts` and add your tool to the `Tool` union:

```typescript
export type Tool =
  | 'move' | 'select' | 'lasso' | /* existing tools */
  | 'smudge'   // ← add here
```

This one change propagates the type to `AppState.activeTool`, `TOOL_REGISTRY`, and everywhere else `Tool` is used.

---

## Step 2: Create the tool folder

```
src/tools/
  smudge.tsx      ← handler factory + options component
```

Tools live directly in `src/tools/`. For a tool with complex algorithm helpers, you can add them to `src/tools/algorithm/`.

---

## Step 3: Write the module-level options object

Options are stored at **module level** (not in React state) because the tool handler is a plain object that cannot call hooks. The canvas's cursor-size rendering also needs to read the options synchronously.

```typescript
// src/tools/smudge.tsx

export const smudgeOptions = {
  size:     30,
  strength: 50,   // 0–100
  hardness: 80,   // 0–100
}
```

Export this object — `Canvas.tsx` imports it to determine the cursor circle size for the brush cursor.

---

## Step 4: Write the handler factory

```typescript
import type { ToolHandler, ToolContext, ToolPointerPos } from '@/tools/types'
import { walkQuadBezier } from '@/tools/algorithm/bresenham'

export const smudgeOptions = {
  size:     30,
  strength: 50,
  hardness: 80,
}

function createSmudgeHandler(): ToolHandler {
  // Stroke-scoped state: reset on every pointerdown
  let lastX: number | null = null
  let lastY: number | null = null

  return {
    onPointerDown({ x, y }: ToolPointerPos, ctx: ToolContext): void {
      const { layer, renderer } = ctx

      // Ensure the layer is large enough to cover where the tool will draw.
      // growLayerToFit expands layer.data and adjusts layer.offsetX/Y if the
      // point falls outside the current layer bounds.
      ctx.growLayerToFit(Math.round(x), Math.round(y), Math.ceil(smudgeOptions.size / 2) + 2)

      lastX = x
      lastY = y

      // Apply the smudge at the first contact point
      applySmudge(x, y, x, y, ctx)

      renderer.flushLayer(layer)
      ctx.render(ctx.layers)
    },

    onPointerMove({ x, y }: ToolPointerPos, ctx: ToolContext): void {
      if (lastX === null || lastY === null) return
      const { layer, renderer } = ctx
      const size = smudgeOptions.size

      ctx.growLayerToFit(Math.round(x), Math.round(y), Math.ceil(size / 2) + 2)

      applySmudge(lastX, lastY, x, y, ctx)

      lastX = x
      lastY = y

      renderer.flushLayer(layer)
      ctx.render(ctx.layers)
    },

    onPointerUp(_pos: ToolPointerPos, ctx: ToolContext): void {
      lastX = null
      lastY = null
      // commitStroke writes a history entry.
      // The label appears in the History panel.
      ctx.commitStroke('Smudge')
    },
  }
}
```

### Understanding `ToolContext`

`ToolContext` is built fresh by `Canvas.tsx` on every pointer event and passed into every handler call. It gives you:

| Property | Type | Description |
|---|---|---|
| `renderer` | `WebGPURenderer` | Read layer pixels, flush to GPU, fire render passes |
| `layer` | `GpuLayer` | The **active layer** — layer-local pixel buffer + geometry |
| `layers` | `GpuLayer[]` | All GPU layers — needed for `ctx.render(layers)` |
| `primaryColor` | `RGBAColor` | Current foreground color |
| `secondaryColor` | `RGBAColor` | Current background color |
| `selectionMask` | `Uint8Array \| null` | Canvas-sized alpha mask (0 = masked, 255 = fully selected) |
| `zoom` | `number` | Current canvas zoom level |
| `render` | `(layers?: GpuLayer[]) => void` | Composite and display the layers |
| `commitStroke` | `(label: string) => void` | Capture a history entry and reset dirty state |
| `growLayerToFit` | `(canvasX, canvasY, pad?) => void` | Expand layer bounds to cover a canvas-space point |

### Coordinate spaces

This is the most common source of bugs. There are three coordinate spaces:

**Canvas space** — the coordinate system of the document (e.g. 0,0 to 1920,1080). Pointer events give you canvas-space coordinates after the zoom/pan transform is applied.

**Layer-local space** — coordinates relative to the layer's top-left corner. `layer.data` is indexed in layer-local space:
```typescript
const pixelIndex = (layerLocalY * layer.layerWidth + layerLocalX) * 4
```

Converting canvas space → layer-local space:
```typescript
const lx = canvasX - layer.offsetX
const ly = canvasY - layer.offsetY
```

**Screen space** — CSS pixels on screen. You rarely need this in tools.

When writing pixels, **always write in layer-local space**:

```typescript
function applySmudge(x0: number, y0: number, x1: number, y1: number, ctx: ToolContext): void {
  const { layer, selectionMask, renderer } = ctx
  const { layerWidth, layerHeight, offsetX, offsetY, data } = layer
  const size = smudgeOptions.size
  const strength = smudgeOptions.strength / 100
  const radius = Math.ceil(size / 2)

  // Convert canvas-space center to layer-local
  const cx = Math.round(x1) - offsetX
  const cy = Math.round(y1) - offsetY

  const dx = x1 - x0
  const dy = y1 - y0

  // Smear pixels in the direction of motion
  for (let sy = cy - radius; sy <= cy + radius; sy++) {
    for (let sx = cx - radius; sx <= cx + radius; sx++) {
      if (sx < 0 || sy < 0 || sx >= layerWidth || sy >= layerHeight) continue

      const dist = Math.hypot(sx - cx, sy - cy)
      if (dist > radius) continue

      // Respect the selection mask (canvas-space index)
      if (selectionMask) {
        const canvasX = sx + offsetX
        const canvasY = sy + offsetY
        const maskIdx = canvasY * renderer.pixelWidth + canvasX
        if (selectionMask[maskIdx] === 0) continue
      }

      // Sample the source pixel offset by motion direction
      const srcX = Math.round(sx - dx * strength)
      const srcY = Math.round(sy - dy * strength)
      if (srcX < 0 || srcY < 0 || srcX >= layerWidth || srcY >= layerHeight) continue

      const dstIdx = (sy * layerWidth + sx) * 4
      const srcIdx = (srcY * layerWidth + srcX) * 4

      const falloff = 1 - dist / radius  // linear falloff
      const t = strength * falloff

      // Lerp toward the source sample
      data[dstIdx]     = Math.round(data[dstIdx]     * (1 - t) + data[srcIdx]     * t)
      data[dstIdx + 1] = Math.round(data[dstIdx + 1] * (1 - t) + data[srcIdx + 1] * t)
      data[dstIdx + 2] = Math.round(data[dstIdx + 2] * (1 - t) + data[srcIdx + 2] * t)
      data[dstIdx + 3] = Math.round(data[dstIdx + 3] * (1 - t) + data[srcIdx + 3] * t)
    }
  }
}
```

### Per-stroke coverage tracking

For tools like brushes where you want to prevent alpha accumulation within a single stroke (i.e., painting over already-painted pixels shouldn't keep darkening them), use a `Map<number, number>` keyed by packed pixel index:

```typescript
let touched: Map<number, number> | null = null

onPointerDown: () => {
  touched = new Map()
  // pass to painting function:
  paintWithCoverage(x, y, ctx, touched)
}

onPointerUp: () => {
  touched = null
}

function paintWithCoverage(x, y, ctx, touched) {
  const packedIdx = layerY * layer.layerWidth + layerX
  const prevAlpha = touched.get(packedIdx) ?? 0
  const effectiveAlpha = Math.max(prevAlpha, desiredAlpha)
  const alphaToApply = effectiveAlpha - prevAlpha
  if (alphaToApply <= 0) return
  touched.set(packedIdx, effectiveAlpha)
  // write pixel with alphaToApply
}
```

This is how `brush.tsx` implements its opacity system — one pass of a 50%-opacity brush stays at 50% even if you move back over it within the same stroke.

### Using WASM for CPU-intensive operations

If your tool's algorithm is too slow in JavaScript (e.g., a flood-based smear, convolution), implement it in C++ and call it via the WASM wrapper:

```typescript
import { getPixelOps } from '@/wasm'

async function applySmudgeWasm(layer: GpuLayer, x, y, dx, dy, strength): Promise<void> {
  const m = await getPixelOps()
  // Pass layer.data to WASM, get back modified buffer
  const ptr = m._malloc(layer.data.byteLength)
  m.HEAPU8.set(layer.data, ptr)
  m._smudge(ptr, layer.layerWidth, layer.layerHeight, x, y, dx, dy, strength)
  // Re-read HEAPU8 in case memory grew
  layer.data.set(m.HEAPU8.subarray(ptr, ptr + layer.data.byteLength))
  m._free(ptr)
}
```

But for simple smudge operations at small brush sizes, JavaScript is fast enough.

---

## Step 5: Write the options UI component

The options component is rendered in the `ToolOptionsBar` at the top of the application whenever the tool is active. It should be a **lean React component** that directly mutates the module-level options object and forces a re-render only if the toolbar needs to update.

```typescript
// src/tools/smudge.tsx (continued)

import React from 'react'
import styles from './smudge.module.scss'

export function SmudgeOptions(): React.JSX.Element {
  // Local state only for the UI to respond to changes.
  // The actual options live in the module-level smudgeOptions object.
  const [, rerender] = React.useReducer(x => x + 1, 0)

  const set = (key: keyof typeof smudgeOptions, value: number): void => {
    smudgeOptions[key] = value
    rerender()
  }

  return (
    <div className={styles.bar}>
      <label>Size
        <input
          type="range" min={1} max={200} step={1}
          value={smudgeOptions.size}
          onChange={e => set('size', Number(e.target.value))}
        />
        <span>{smudgeOptions.size}px</span>
      </label>
      <label>Strength
        <input
          type="range" min={0} max={100} step={1}
          value={smudgeOptions.strength}
          onChange={e => set('strength', Number(e.target.value))}
        />
        <span>{smudgeOptions.strength}%</span>
      </label>
    </div>
  )
}
```

Why mutate the module-level object directly instead of using `useState`? Because **pointer event handlers do not participate in the React rendering cycle**. When the user is dragging the mouse, `onPointerMove` fires dozens of times per second. If it read options via `useState`, it would capture a stale closure. The module-level object is always current.

---

## Step 6: Export the tool definition

At the bottom of `smudge.tsx`, export a `ToolDefinition`:

```typescript
import type { ToolDefinition } from '@/tools/types'

export const smudgeTool: ToolDefinition = {
  createHandler: createSmudgeHandler,
  Options: SmudgeOptions,
  modifiesPixels: true,
  paintsOntoPixelLayer: true,
}
```

`modifiesPixels: true` tells `Canvas.tsx` that this tool will dirty the layer and needs a history entry on completion. `paintsOntoPixelLayer: true` tells the toolbar that the active layer must be a pixel layer (not a group or adjustment) for the tool to be enabled.

---

## Step 7: Register the tool

Open `src/tools/index.ts` and add an entry to `TOOL_REGISTRY`:

```typescript
import { smudgeTool } from './smudge'

export const TOOL_REGISTRY: Record<Tool, ToolDefinition> = {
  // ... existing tools ...
  smudge: smudgeTool,
}
```

The `Record<Tool, ToolDefinition>` type will produce a TypeScript error until you add the `smudge` key — the compiler enforces exhaustiveness.

---

## Step 8: Add the tool icon to the Toolbar

Open `src/ux/main/Toolbar/Toolbar.tsx` and add the tool button. The Toolbar renders a list of tool groups; find the right group and add an entry:

```typescript
// In the TOOLS constant or wherever tool buttons are defined:
{ tool: 'smudge', icon: <SmudgeIcon />, title: 'Smudge (U)' },
```

Create or source an SVG icon. Icons are typically small (16×16 or 20×20) monochrome SVGs, rendered inline as React components.

---

## Step 9: Add a keyboard shortcut (optional)

Open `src/core/services/useKeyboardShortcuts.ts`. Add a case for the new tool:

```typescript
// In the keydown handler:
case 'u':
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
    handleToolChange('smudge')
    e.preventDefault()
  }
  break
```

Update `src/ux/modals/KeyboardShortcutsDialog/KeyboardShortcutsDialog.tsx` to list the new shortcut.

---

## Step 10: Handle the custom cursor (optional)

Tools with a size-dependent cursor (brush, eraser, smudge) should display a circle that reflects the current brush size instead of the default crosshair. This is driven by `cursorStore`:

```typescript
// In Canvas.tsx, in onPointerMove (after existing cursor logic):
if (state.activeTool === 'smudge') {
  cursorStore.set({ x: canvasX, y: canvasY, radius: smudgeOptions.size / 2 / zoom })
}
```

The cursor rendering itself is already handled by the canvas wrapper — you only need to write the correct size to `cursorStore`.

---

## Complete checklist

- [ ] Add `'smudge'` to the `Tool` union in `src/types/index.ts`
- [ ] Create `src/tools/smudge.tsx` with:
  - [ ] Module-level `smudgeOptions` object (exported)
  - [ ] `createSmudgeHandler()` factory
  - [ ] `SmudgeOptions` React component
  - [ ] `smudgeTool: ToolDefinition` export
- [ ] Register in `src/tools/index.ts` → `TOOL_REGISTRY`
- [ ] Add icon + button in `src/ux/main/Toolbar/Toolbar.tsx`
- [ ] Add keyboard shortcut in `useKeyboardShortcuts.ts`
- [ ] List shortcut in `KeyboardShortcutsDialog.tsx`
- [ ] (If modifying pixels) verify `ctx.commitStroke()` is called in `onPointerUp`
- [ ] (If WASM) add C++ impl, export symbol, add TS wrapper
