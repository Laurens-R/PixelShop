# Object Selection Tool

## Overview

The **Object Selection Tool** lets users isolate an object by drawing a rough hint region around it — either a rectangle or a freehand lasso path — and having the tool automatically refine the selection to the object's actual edges. The refinement is performed by a GrabCut-style graph-cut segmentation algorithm running locally in the C++/WASM layer; no network calls, AI model, or server connection are required. This covers the most common selection workflow where the user can identify *roughly* where an object is but does not want to trace its exact boundary by hand.

---

## User Interaction

### Activating the tool

The user clicks the Object Selection icon in the toolbox or presses **W**. The cursor changes to indicate the active hint-drawing mode (crosshair for rectangle, lasso cursor for lasso).

### Drawing a hint region — Rectangle mode

1. With **Rect** selected in the options bar, the user positions the cursor at any corner of the region of interest.
2. The user presses and holds the pointer button, then **drags** to the opposite corner. A dashed rubber-band rectangle is drawn on the canvas overlay in real time, tracking the drag.
3. On pointer release the hint region is finalised. The tool reads the image data within and around the rectangle, submits it to the WASM segmentation algorithm, and waits for the result.
4. When the algorithm returns, the resulting mask is committed to `selectionStore` and the marching-ants overlay replaces the rubber-band rectangle.

### Drawing a hint region — Lasso mode

1. With **Lasso** selected in the options bar, the user presses the pointer button anywhere on the canvas to begin the freehand path.
2. While holding the button, the user **drags** to draw the outline of the rough region. A dashed path is rendered on the canvas overlay in real time, following the pointer.
3. On pointer release, the open path is automatically closed with a straight segment from the current position back to the start point. The enclosed region becomes the hint area and is submitted to the algorithm.
4. When the algorithm returns, the resulting mask is committed to `selectionStore` and the marching-ants overlay appears.

### Modifier keys for selection mode

The selection mode is determined by modifier keys held **at the moment the pointer is pressed** to begin a new hint region. Modifier state is not re-read during the drag.

| Modifier held on press | Mode | Effect on existing selection |
|---|---|---|
| None | **New / Replace** | Replaces the existing selection with the refined result |
| Shift | **Add** | Unions the refined result with the existing selection |
| Alt | **Subtract** | Removes the refined result from the existing selection |
| Shift + Alt | **Intersect** | Retains only the area covered by both the existing selection and the refined result |

Modifier keys always override the **Mode** setting in the options bar for that operation.

### Cancelling

- Pressing **Escape** while the hint drag is in progress discards the rubber-band overlay and cancels the operation. The existing selection is unchanged.
- Pressing **Escape** after a hint has been submitted to the algorithm (while the computation is running) cancels the pending result. If the algorithm finishes before the cancellation is processed, the result is discarded and the selection is not changed.

---

## Algorithm

The refinement step is a **GrabCut-style iterative graph-cut segmentation** executed in the C++/WASM layer.

### Inputs

- **Image data**: the RGBA pixel buffer for the region being segmented. If **Sample All Layers** is on, this is the flattened composite of all visible layers; if off, it is the active layer only.
- **Hint region**: the polygon or rectangle drawn by the user, expressed in canvas coordinates.

### Seed classification

Before the first graph-cut iteration, pixels are seeded as follows:

- Pixels **inside** the hint region are marked as **probable foreground**.
- Pixels **outside** the hint region (within a contextual border margin around the hint) are marked as **definite background**.

### Iterative refinement

The algorithm runs graph-cut iterations, alternating between:

1. **GMM fitting** — Gaussian Mixture Models are updated for the foreground and background pixel classes based on the current labelling.
2. **Graph-cut** — a min-cut/max-flow pass reassigns each pixel to foreground or background by minimising an energy that combines colour likelihood (data term) and spatial smoothness (boundary term).

Iterations continue until the labelling converges or a fixed iteration limit is reached.

### Output

A single-channel **8-bit mask** the size of the canvas, where:
- `255` = foreground (selected)
- `0` = background (not selected)
- Intermediate values (0–255) may exist at refined edges before anti-alias and feather post-processing.

---

## Options Bar

The Object Selection options bar contains the following controls, in order:

### Mode
Four icon buttons: **New**, **Add**, **Subtract**, **Intersect**. The highlighted button is the persistent default mode used when no modifier key is held. Modifier keys held at drag-start always override this setting for that operation.

### Hint Drawing Mode
A toggle between **Rect** (rectangle drag) and **Lasso** (freehand path). Controls the shape of the hint region the user draws. Default: **Rect**.

### Sample All Layers
A checkbox. When **on**, the image data fed to the segmentation algorithm is the flattened composite of all visible layers, giving the algorithm full context regardless of which layer is active. When **off**, only the pixels from the active layer are sampled. Default: **off**.

### Anti-alias
A checkbox. When **on** (the default), the raw algorithm output mask is post-processed to produce smooth sub-pixel edges before being written to `selectionStore`. When **off**, the mask is written as-is, which may produce jagged edges. Default: **on**.

### Feather
A numeric input (pixels). When greater than 0, applies a Gaussian feather to the selection edge after anti-alias processing. The feather radius is passed to `selectionStore.applyFeather`. Default: **0 px**.

### Hard Edge
A checkbox. When **on**, post-processes the final mask by thresholding: any mask value ≥ 128 is snapped to 255 (fully selected) and any value < 128 is snapped to 0 (not selected), eliminating all partially-transparent edge pixels. This is applied *after* anti-alias and feather steps; enabling it effectively cancels their softening effect. When **off** (the default), the soft mask is preserved. Default: **off**.

---

## Post-Processing Pipeline

After the WASM algorithm returns the raw mask, the following steps are applied in order before committing to `selectionStore`:

1. **Anti-alias** (if enabled): smooth the mask edges using sub-pixel anti-aliasing.
2. **Feather** (if > 0 px): apply a Gaussian blur of the specified radius to the mask.
3. **Hard Edge** (if enabled): threshold the mask at 128 — values ≥ 128 become 255, values < 128 become 0.
4. **Selection mode composite**: combine the processed mask with the existing selection according to the active mode (New / Add / Subtract / Intersect).
5. Commit the final mask to `selectionStore` and trigger a marching-ants overlay refresh.

---

## Visual Feedback

### During hint drawing

- **Rect mode**: a dashed rubber-band rectangle is drawn on the canvas overlay, updating on every pointer-move event. The rectangle is not composited into pixel data.
- **Lasso mode**: a dashed freehand path is drawn on the canvas overlay, trailing the pointer. A straight closing segment from the current pointer position back to the start point is shown in real time to indicate where the path will be closed on release.

### During algorithm computation

- The rubber-band overlay is hidden on pointer release.
- A **progress indicator** (spinner or indeterminate bar) is shown to communicate that processing is underway. The canvas is not blocked — the user can see the current marching-ants selection while waiting.

### After commitment

- The marching-ants overlay updates to reflect the new selection mask.
- If the refined selection is empty (zero selected pixels), no marching ants are shown and any previous selection is replaced with an empty selection (or modified per the current mode).

---

## Functional Requirements

- The tool **must** be accessible from the toolbox and activated by the keyboard shortcut **W**.
- The tool **must** support two hint-drawing modes: **Rect** (drag a rectangle) and **Lasso** (freehand closed path).
- While drawing a hint, a dashed overlay **must** be rendered on the canvas in real time to show the region being defined.
- On pointer release, the tool **must** submit the image data and hint region to the WASM segmentation algorithm.
- The algorithm **must** run locally in C++/WASM with no network calls.
- When **Sample All Layers** is on, the image data submitted to the algorithm **must** be the composite of all visible layers. When off, it **must** be the active layer's pixels only.
- The raw algorithm output **must** be post-processed through the anti-alias → feather → hard-edge pipeline in that order before being written to `selectionStore`.
- The **Hard Edge** option **must** threshold the mask at 128: values ≥ 128 → 255, values < 128 → 0.
- The **Feather** radius **must** be applied via `selectionStore.applyFeather`.
- Selection mode (New / Add / Subtract / Intersect) **must** be applied as specified by the modifier key held at drag-start, or by the options bar Mode setting when no modifier is held.
- Pressing **Escape** during a hint drag **must** cancel the operation and leave the existing selection unchanged.
- Pressing **Escape** during WASM computation **must** cancel the pending result; if the result arrives after cancellation, it **must** be discarded.
- A **progress indicator** must be shown while the WASM computation is running.
- The rubber-band overlay **must not** be composited into the layer's pixel data.
- After the algorithm finishes, the marching-ants overlay **must** update to reflect the committed selection.
- The **Hint Drawing Mode** toggle **must** visibly indicate the active mode (Rect or Lasso) in the options bar.

---

## Acceptance Criteria

- With no existing selection, dragging a rectangle around an object in Rect mode commits a refined selection that follows the object's edges rather than the exact rectangle boundary.
- With no existing selection, drawing a lasso outline around an object commits a refined selection approximating the object's boundary.
- Holding **Shift** before beginning a drag adds the new refined region to an existing selection without replacing it.
- Holding **Alt** before beginning a drag subtracts the new refined region from an existing selection.
- Pressing **Escape** during a drag cancels the rubber-band and leaves the previous selection intact.
- With **Sample All Layers** on, the algorithm receives pixel data from all visible layers, not just the active layer.
- With **Hard Edge** on, the committed mask contains only values 0 and 255 — no partial values.
- With **Feather** set to 10 px and **Hard Edge** off, the committed mask has a soft, blurred edge.
- With **Anti-alias** off, the committed mask shows pixel-level jagged edges at the object boundary.
- Pressing **W** activates the Object Selection tool.
- The hint rubber-band is visible during the drag and disappears immediately on pointer release.
- A progress indicator appears after pointer release and disappears when the selection is committed.

---

## Edge Cases & Constraints

- **Hint region smaller than 4 × 4 pixels**: the algorithm may not have sufficient context to segment meaningfully. The operation is permitted but may return an empty or near-empty mask; no error is surfaced.
- **Entire image selected as foreground**: if the hint region covers the full canvas, the background seed region has no pixels. The algorithm is still run but will likely return a fully-selected mask.
- **Active layer fully transparent**: if the active layer has no pixel data and **Sample All Layers** is off, the algorithm receives a blank image. The result will be an empty selection; no error is shown.
- **Hint region entirely outside the canvas**: the rubber-band can be drawn outside canvas bounds, but only the intersection of the hint with the canvas is processed; pixels outside the canvas are not selected.
- **Lasso path self-intersects**: a self-intersecting lasso path is accepted as-is. The enclosed area is determined by the standard even-odd or non-zero winding rule applied to the path; the exact rule is implementation-defined.
- **Computation takes longer than expected**: the progress indicator remains visible for the full duration. The tool remains active and Escape remains responsive.

---

## Out of Scope (v1)

- **Object Finder / hover preview**: hovering over the canvas to auto-detect object regions before the user draws a hint is not implemented. The tool requires an explicit drag gesture to begin.
- **AI/ML model**: no neural network or remote model is used. The algorithm is purely classical graph-cut with no learned weights.
- **Subject selection from full image**: selecting the most prominent subject of the full image without any hint gesture is not supported. The user must always draw a hint.
- **Subject refinement panel**: no secondary dialog for iteratively refining or adding/removing regions after the initial commit.

---

## Related Features

- [Polygonal Selection Tool](polygonal-selection-tool.md) — shares the selection mode modifier-key contract and commits to the same `selectionStore`.
- [Content-Aware Fill](content-aware-fill.md) — a common follow-up operation after isolating an object with Object Selection.
- [Free Transform](free-transform.md) — another operation frequently applied after isolating an object.
- [Filters Menu](filters-menu.md) — filters may be applied to the selection produced by this tool.
