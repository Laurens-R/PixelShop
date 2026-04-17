# PixelShop – Project Guidelines

## Overview

Desktop image editor built with Electron, React 19, TypeScript, WebGL2, and C++/WASM. Intended to be a Photoshop-grade general-purpose image editor. Despite the name, PixelShop is **not** a pixel art tool — it is a full-featured photo and image editor. Pixel art is a supported use case, but the application targets the full breadth of raster image editing (adjustments, filters, layer compositing, curves, color grading, etc.) that you'd expect from a professional tool like Photoshop.

## Build & Dev

```bash
npm run dev          # Start Electron + Vite in development mode
npm run build        # Production build
npm run build:wasm   # Compile C++ → WASM (requires Emscripten, run once after C++ changes)
npm run typecheck    # Type-check both main (Node) and renderer (web) processes
```

## Architecture

PixelShop is an Electron app split into two processes that communicate over IPC:

- **Main process** (`electron/main/`) — Node.js. Handles native file I/O, OS dialogs, and IPC handlers. Never imported from the renderer.
- **Preload** (`electron/preload/`) — Exposes a typed, sandboxed API to the renderer via `window.electron`. This is the only bridge between the two processes.
- **Renderer** (`src/`) — React 19 app. All UI, canvas drawing, and tool logic lives here.

### Renderer structure

The renderer is organized around a clear separation of concerns:

```
src/
  App.tsx              ← thin orchestrator: composes hooks, renders layout
  store/               ← global state (AppContext, CanvasContext)
  hooks/               ← all business logic
  components/          ← all UI
  tools/               ← drawing tool handlers + options UIs
  webgl/               ← WebGL2 renderer
  wasm/                ← TypeScript wrapper over C++/WASM
  export/              ← file export helpers
  types/               ← shared TypeScript types
```

**`App.tsx` is a thin orchestrator.** It composes hooks and renders the layout — nothing more. Business logic that would otherwise live inline in `App.tsx` belongs in a dedicated hook under `src/hooks/`.

### Hooks (`src/hooks/`)

Each hook owns **one cohesive concern** and encapsulates all business logic for that domain. Hooks accept a `canvasHandleRef` and `dispatch` as inputs and never hold UI state. Examples of the expected granularity: file operations (`useFileOps`), layer manipulation (`useLayers`), undo/redo history (`useHistory`), canvas dimension transforms (`useCanvasTransforms`). If a hook is doing two clearly unrelated jobs, split it.

### Components (`src/components/`)

Components are divided into four categories. Choosing the right category is important — it defines what the component is allowed to know about.

| Category | Path | What it can access |
|---|---|---|
| **Widgets** | `widgets/` | Props only. Stateless, reusable anywhere. No app state. |
| **Panels** | `panels/` | `AppContext` directly. Owns its own state reads and dispatches. |
| **Dialogs** | `dialogs/` | Wraps `ModalDialog`. Composes widgets and panels. |
| **Window** | `window/` | Layout chrome. Embeds panels and widgets; never re-implements panel logic inline. |

**The key rule:** a widget must never reach into `AppContext`, and a window component must never duplicate logic that belongs in a panel. For example, `RightPanel` (window) hosts `ColorPicker` and `LayerPanel` (panels) — it renders them, not their contents.

**Folder conventions:** one component per folder with a PascalCase name. Each folder contains exactly `ComponentName.tsx` and `ComponentName.module.scss`. All components are exported from `src/components/index.ts`. Always check existing components before building new UI.

### Tools (`src/tools/`)

Each tool exports two things:
1. A **handler factory** (e.g. `createBrushHandler()`) — a plain object with pointer event callbacks, no React.
2. A **React options UI component** — rendered in the tool options bar.

Drawing options (size, opacity, hardness, etc.) are stored in a **module-level options object** (e.g. `export const brushOptions = { size: 10, ... }`). This is intentional: pointer event handlers run synchronously and cannot read React state. The options object is also exported so `Canvas.tsx` can read the current brush size for cursor rendering without coupling to React state.

### State

Global app state (active tool, colors, layers, swatches) flows through `AppContext` via `useReducer`. The pattern for adding new state:
1. Add the new field to `AppState` in `src/types/index.ts`.
2. Add the reducer action to `AppContext.tsx`.
3. Export `AppAction` so hooks outside `AppContext.tsx` can dispatch.

Tab state (multi-document) lives in `useTabs`. Canvas pixel data lives in WebGL while a tab is active and is serialized to `savedLayerData` only when the tab is backgrounded. Operations that change the canvas dimensions (resize, crop) must increment `canvasKey` on the tab record to force a Canvas remount with the new size.

Avoid re-initializing canvas layers in effects that list `rendererRef.current` as a dependency — use a `hasInitializedRef` guard instead.

### WebGL (`src/webgl/`)

`WebGLRenderer.ts` is the low-level pixel read/write layer. It operates on `WebGLLayer` objects and exposes methods used by tools and layer operations. Do not bypass it to manipulate pixel data directly.

Layer compositing for flatten/merge/export is centralized in the unified rasterization pipeline (`src/rasterization/`) and executed from a shared render plan. Do not add separate compositing implementations for these operations.

### Unified Rasterization Pipeline

- Flatten, merge, and export must all run through the same centralized rasterization pipeline. Do not add ad-hoc compositing paths for one operation.
- GPU render-plan execution is the source of truth for compositing parity.
- Temporary preview-bypass state must never leak into final flatten/export/merge outputs.
- If flatten/export/merge execution fails, surface the error to the user. Never silently no-op.

Maintenance checklist for new adjustment/filter types:
1. Add the new adjustment/filter to the adjustment registry and related adjustment types.
2. Add its render-plan entry mapping.
3. Add its WebGL pass/shader path.
4. Ensure unified rasterization includes it for flatten/export/merge.
5. Add or update parity tests across screen preview, flatten, and export outputs.

CPU fallback policy:
- If CPU fallback is introduced or re-enabled, parity-validate it against the GPU path before activation.
- CPU fallback must not silently degrade output quality or compositing correctness.

### Drawing / Pixel Operations

- All pixel blending uses **Porter-Duff "over" compositing** via `blendPixelOver` in `bresenham.ts`.
- Track per-stroke coverage with a `Map<number, number>` (key = packed pixel index, value = max effective alpha applied) to prevent opacity accumulation within a single stroke.
- Thick brush shapes: **circle stamp** for hard edges; **capsule SDF** for anti-aliased thick lines. Both helpers live in `bresenham.ts`.

## Conventions

### CSS Modules

Always use `.module.scss`. Vite treats plain `.scss` default imports as `undefined` at runtime, causing silent failures.

```ts
import styles from './MyComponent.module.scss'
// use as: styles.myClass
```

### IPC

Main → Renderer communication goes through `electron/main/ipc.ts` and the typed preload at `electron/preload/index.ts`. In the renderer, use `window.electron.ipcRenderer.*`. Never import Electron modules directly in `src/`.

### Pointer / Tablet Input

All pointer events flow through `useCanvas` → `Canvas.tsx` → `ToolHandler`. Never attach raw DOM mouse/touch listeners in tools.

A few non-obvious rules for correct tablet and high-frequency mouse behavior:
- Replay coalesced events (`getCoalescedEvents`) for `pen`/`touch` only — high-polling mice (1000 Hz) generate 16+ coalesced events per frame and will tank performance.
- Use `e.button !== 0` guards on `pointerdown`/`pointerup` to ignore barrel-button and eraser-end events from Wacom tablets.
- Detect silent pen-lift (tip lifts without `pointerup`) by checking `!(e.buttons & 1)` on `pointermove`.
- Pass `e.timeStamp` (not `performance.now()`) through `ToolPointerPos` so velocity-tracking tools get accurate timing from coalesced hardware timestamps.
- For velocity-aware tools, use the **outer event's** `e.pressure` for all coalesced samples — per-coalesced pressure fluctuates at hardware polling rate and causes jitter.

### Canvas Cursor

For tools with a custom cursor (brush, eraser), hide the native cursor (`cursor: none`) and drive a CSS circle div imperatively via a ref on every `onHover` call. Use `white border + dark box-shadow` for visibility on both light and dark canvases. Never update cursor appearance through React state — it would cause unnecessary re-renders on every pointer move.

## WASM / C++ Layer

CPU-intensive operations (flood fill, blur, resize, dithering, quantization) are implemented in C++17 under `wasm/src/` and compiled to WASM via Emscripten. The TypeScript side of this boundary is `src/wasm/index.ts`, which exposes a clean async API. Never import from `src/wasm/generated/` directly.

### Adding a new operation
1. Implement in a new `.h`/`.cpp` under `wasm/src/`.
2. Add an `extern "C" EMSCRIPTEN_KEEPALIVE` wrapper in `wasm/src/pixelops.cpp`.
3. Append the symbol name (with leading `_`) to `-sEXPORTED_FUNCTIONS` in `wasm/CMakeLists.txt`.
4. Add the TypeScript signature to `src/wasm/types.ts` and a high-level wrapper to `src/wasm/index.ts`.
5. Run `npm run build:wasm`.

### Memory rules
- All WASM buffers are managed via `_malloc`/`_free` — the wrapper handles this automatically.
- Re-read `module.HEAPU8` **after** any WASM call (memory may have been grown); the wrapper's `withInPlaceBuffer` does this correctly.
- `src/wasm/generated/` is gitignored — run `build:wasm` on a fresh clone.

### Setting up Emscripten (first time)
```powershell
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
.\emsdk install latest
.\emsdk activate latest
.\emsdk_env.ps1         # re-run in each new terminal

# Back in PixelShop:
npm run build:wasm
```
