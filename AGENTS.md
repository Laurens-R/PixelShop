# PixelShop – Project Guidelines

## Overview

Desktop pixel art / image editor built with Electron, React 19, TypeScript, WebGL2, and C++/WASM. It is intended to be a Photoshop clone as much as possible.

## Build & Dev

```bash
npm run dev          # Start Electron + Vite in development mode
npm run build        # Production build
npm run build:wasm   # Compile C++ → WASM (requires Emscripten, run once after C++ changes)
npm run typecheck    # Type-check both main (Node) and renderer (web) processes
```

## Architecture

| Area | Path | Notes |
|---|---|---|
| Electron main | `electron/main/` | Node process, file I/O, IPC handlers |
| Electron preload | `electron/preload/` | Exposes safe APIs to renderer |
| Renderer (React) | `src/` | All UI and drawing logic |
| **App entry** | `src/App.tsx` | Thin orchestration only — composes hooks, renders layout. No business logic inline. |
| Components | `src/components/` | One folder per component; each has `Component.tsx` + `Component.module.scss` |
| — Panels | `src/components/panels/` | Self-contained data-connected panels: `ColorPicker`, `LayerPanel`, `Navigator`, `SwatchPanel` |
| — Widgets | `src/components/widgets/` | Reusable, stateless UI primitives: `SliderInput`, `DialogButton` |
| — Dialogs | `src/components/dialogs/` | Modal overlays: `ModalDialog`, `NewImageDialog`, `ExportDialog`, `ColorPickerDialog` |
| — Window | `src/components/window/` | Layout chrome wired to app state: `Canvas`, `MenuBar`, `RightPanel`, `StatusBar`, `TabBar`, `Toolbar`, `ToolOptionsBar`, `TopBar` |
| **App hooks** | `src/hooks/` | All business-logic hooks extracted from `App.tsx` (see table below) |
| Tools | `src/tools/` | Each tool exports a handler factory + options UI component |
| Algorithms | `src/tools/algorithm/` | Graphic manipulation algorithms |
| Export helpers | `src/export/` | `exportPng`, `exportJpeg`, `exportWebp`, `imageLoader` |
| **WASM C++ source** | `wasm/src/` | C++17 implementations of CPU-intensive ops |
| **WASM build config** | `wasm/CMakeLists.txt` | Emscripten build; outputs to `src/wasm/generated/` |
| **WASM TS wrapper** | `src/wasm/index.ts` | Async API over the WASM module (singleton) |
| **WASM types** | `src/wasm/types.ts` | `PixelOpsModule` interface for the generated module |
| WebGL renderer | `src/webgl/WebGLRenderer.ts` | Low-level pixel read/write on `WebGLLayer` objects |
| Global state | `src/store/AppContext.tsx` | `useReducer`-based app state (tool, colors, swatches, layers); exports `AppAction` type |
| Canvas state | `src/store/CanvasContext.tsx` | Active canvas / renderer reference |
| Tab types | `src/store/tabTypes.ts` | `TabRecord`, `TabSnapshot`, `makeTabId`, `fileTitle`, `INITIAL_SNAPSHOT` |
| Types | `src/types/index.ts` | Shared types (e.g. `RGBAColor`, `AppState`) |

### App hooks (`src/hooks/`)

Each hook owns one cohesive concern. All accept a `canvasHandleRef` and `dispatch`; none hold UI state.

| Hook | Responsibility |
|---|---|
| `useTabs` | Tab records, per-tab canvas handle map, switch/close tab, `captureActiveSnapshot` |
| `useHistory` | `captureHistory`, history preview/jump-to effects, auto-capture on layer add/remove |
| `useFileOps` | New/open/save — file dialogs, `.pxshop` serialization, image import |
| `useClipboard` | Copy, cut, paste, delete — operates on the active layer + selection mask |
| `useLayers` | Merge selected/down/visible, new/duplicate/delete/flatten layer; `compositeLayers` |
| `useCanvasTransforms` | Resize image, resize canvas, crop — all trigger Canvas remount via `canvasKey` |
| `useKeyboardShortcuts` | Global `keydown` handler wired to the above actions |
| `useCanvas` | Low-level pointer capture, coalesced-event replay (pen/touch only), `isDrawing` guard |

## Conventions

### CSS Modules
- **Always use `.module.scss`** — Vite treats plain `.scss` default imports as `undefined`, causing runtime crashes.
- Import as: `import styles from './MyComponent.module.scss'`
- Class names accessed as: `styles.myClass`

### Components

Components are organized into four sub-categories under `src/components/`:

| Category | Path | Purpose |
|---|---|---|
| **Panels** | `panels/` | Self-contained panels that connect directly to `AppContext`. Each reads its own state and dispatches its own actions. |
| **Widgets** | `widgets/` | Primitive, fully reusable UI elements with no knowledge of app state. Accept only props. |
| **Dialogs** | `dialogs/` | Modal overlays that wrap `ModalDialog` and compose widgets/panels. |
| **Window** | `window/` | Top-level layout chrome components. May use other panels and widgets; should not duplicate logic already in a panel. |

**Folder conventions:** One component per folder (PascalCase name). Each folder contains exactly `ComponentName.tsx` and `ComponentName.module.scss`. Export all components from `src/components/index.ts`.

**Component reuse rules:**
- **Always check `src/components/` before building new UI.** Prefer composing existing panels, widgets, and dialogs over writing new ones.
- Window components should embed panels (e.g. `RightPanel` hosts `ColorPicker`, `SwatchPanel`, `Navigator`, `LayerPanel`) rather than re-implementing their content inline.
- Widgets (`SliderInput`, `DialogButton`) must remain stateless and prop-driven so they can be used anywhere.
- When extracting repeated UI into a new component, place it in the most appropriate sub-category above and export it from `src/components/index.ts`.

### Tools
- Each tool supplies a **handler factory** (e.g. `createPencilHandler()`) and a **React options UI** component.
- Share mutable drawing options via a **module-level options object** (e.g. `pencilOptions`, `brushOptions`, `eraserOptions`) — do not use React state or context for values that must be read synchronously inside pointer event handlers.
- Export the options object (`export const brushOptions`) so `Canvas.tsx` can read size/shape for cursor rendering without importing tool internals into React state.

### Pointer / Tablet input
- All pointer events flow through `useCanvas` → `Canvas.tsx` → `ToolHandler`. Never attach raw DOM mouse/touch listeners in tools.
- `touch-action: none` must be set on the `<canvas>` element to prevent browser gesture interference with pen/tablet input.
- Coalesced events (`getCoalescedEvents`) are replayed for `pen`/`touch` pointerType only. Skip them for `mouse` — high-polling mice (1000 Hz) produce 16+ coalesced events/frame and tank WebGL performance.
- Use `e.button !== 0` guards on `pointerdown`/`pointerup` to ignore barrel-button and eraser-end events from Wacom tablets.
- Detect silent pen-lift (pen tip lifts without firing `pointerup`) by checking `!(e.buttons & 1)` on `pointermove`.
- Pass `e.timeStamp` (not `performance.now()`) through `ToolPointerPos` so velocity-tracking tools compute correct speed from coalesced hardware timestamps.
- For velocity-aware tools (`brush`), use the outer event's `e.pressure` for all coalesced samples — per-coalesced pressure fluctuates at hardware polling rate and causes visible size/opacity jitter.

### Canvas cursor
- Brush and eraser tools hide the native cursor (`cursor: none`) and render a CSS circle div (`.brushCursor` in `Canvas.module.scss`) sized to the brush radius in screen pixels.
- The circle is updated imperatively (`brushCursorRef`) on every `onHover` call — no React state, no re-renders.
- `white border + dark box-shadow` on the cursor circle gives visibility on both light and dark canvases (same technique as Photoshop).

### State
- Global app state flows through `AppContext` via `useReducer`. Add new state to `AppState` in `src/types/index.ts` first, then wire up the reducer action in `AppContext.tsx`. Export `AppAction` for use in hooks outside `AppContext.tsx`.
- Do **not** re-initialize canvas layers in an effect that lists `rendererRef.current` as a dependency — use a `hasInitializedRef` guard to prevent wipes on re-render.
- Tab state (multi-document) lives in `useTabs`. Canvas pixel data is only serialized to `savedLayerData` when a tab is backgrounded; the active tab's data lives in WebGL.
- Canvas-dimension-changing operations (resize image, resize canvas, crop) must increment `canvasKey` on the tab record to force a Canvas remount with the new size.

### Drawing / Pixel Operations
- All pixel blending uses **Porter-Duff "over" compositing** via `blendPixelOver` in `bresenham.ts`.
- Track per-stroke coverage with a `Map<number, number>` (key = packed pixel index, value = max effective alpha applied) to prevent opacity accumulation within a single stroke.
- Thick brush shapes: **circle stamp** (`stampCircle`) for hard edges; **capsule SDF** (`drawAAThickSegment`) for anti-aliased thick lines.
- Layer compositing (for merge operations) is implemented in `useLayers.ts` (`compositeLayers`) and must match the GLSL blend-mode shader in `WebGLRenderer.ts` exactly.

## IPC Pattern
- Main → Renderer messages go through `electron/main/ipc.ts` and the typed preload at `electron/preload/index.ts`.
- Use `window.electron.ipcRenderer.*` in the renderer; never import Electron modules directly in `src/`.

## WASM / C++ Layer

CPU-intensive graphics operations live in `wasm/src/` (C++17) and are called from TypeScript via `src/wasm/index.ts`.

### Available operations

| Function (TS) | C++ impl | Notes |
|---|---|---|
| `floodFill` | `fill.cpp` | Scanline BFS, RGBA tolerance |
| `gaussianBlur` | `filters.cpp` | Separable 1-D passes, O(n·k) |
| `convolve` | `filters.cpp` | Generic 2-D kernel, clamp-to-edge |
| `resizeBilinear` | `resize.cpp` | Smooth, for photos |
| `resizeNearest` | `resize.cpp` | Hard edges, for pixel art |
| `ditherFloydSteinberg` | `dither.cpp` | Error-diffusion, takes RGBA palette |
| `ditherBayer` | `dither.cpp` | Ordered dithering, matrix size 2/4/8 |
| `quantize` | `quantize.cpp` | Median-cut, returns RGBA palette |

### Adding a new operation
1. Implement in a new `.h`/`.cpp` under `wasm/src/`.
2. Add an `extern "C" EMSCRIPTEN_KEEPALIVE` wrapper in `wasm/src/pixelops.cpp`.
3. Append the symbol name (with leading `_`) to `-sEXPORTED_FUNCTIONS` in `wasm/CMakeLists.txt`.
4. Add the TypeScript signature to `src/wasm/types.ts` and a high-level wrapper to `src/wasm/index.ts`.
5. Run `npm run build:wasm`.

### Setting up Emscripten (first time)
```powershell
# Clone emsdk anywhere outside the project
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
.\emsdk install latest
.\emsdk activate latest
.\emsdk_env.ps1         # activates this session; re-run in each new terminal

# Back in PixelShop:
npm run build:wasm
```

### Memory rules
- All WASM buffers are managed via `_malloc`/`_free` — the wrapper handles this automatically.
- Re-read `module.HEAPU8` **after** any WASM call (memory may have been grown); the wrapper's `withInPlaceBuffer` does this correctly.
- `src/wasm/generated/` is gitignored — run `build:wasm` on a fresh clone.
