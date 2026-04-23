# Content-Aware Fill & Content-Aware Delete

## Overview

Content-Aware Fill and Content-Aware Delete are non-destructive inpainting operations that intelligently fill a user-defined selected region by synthesising texture and colour from the surrounding image context. They allow users to remove unwanted objects, patch damaged areas, or extend backgrounds without manual retouching. Both operations use the PatchMatch algorithm — the same approach used by Photoshop — executed in a high-performance C++/WASM layer.

---

## User Interaction

### Content-Aware Delete

1. The user creates a selection over the area they want to remove (using the lasso, marquee, or magic wand tool).
2. The user invokes **Edit → Content-Aware Delete** (keyboard shortcut: **Shift+Delete** / **Shift+Backspace**).
3. A progress indicator appears (indeterminate spinner or progress bar) while the WASM computation runs.
4. On completion:
   - The selected pixels on the active layer are erased (made transparent).
   - A new raster layer is inserted directly above the active layer, containing the inpainted fill for the erased region.
   - The new fill layer becomes the active (selected) layer.
   - The original selection is preserved.

### Content-Aware Fill

1. The user creates a selection over the area they want to fill.
2. The user invokes **Edit → Content-Aware Fill**.
3. A progress indicator appears while the WASM computation runs.
4. On completion:
   - The active layer is left untouched.
   - A new raster layer is inserted directly above the active layer, containing the inpainted fill for the selected region.
   - The new fill layer becomes the active (selected) layer.
   - The original selection is preserved.

---

## Functional Requirements

- Both **Content-Aware Delete** and **Content-Aware Fill** must appear in the **Edit** menu.
- **Content-Aware Delete** must also be accessible via the keyboard shortcut **Shift+Delete** / **Shift+Backspace**.
- Both menu items must be **disabled (greyed out)** when no selection is active.
- The fill algorithm must use **PatchMatch**:
  - Patches are fixed-size NxN windows (e.g. 7×7 or 9×9 pixels).
  - The fill region is defined by the active selection mask.
  - The source region for patch sampling is the area outside the selection.
  - The algorithm must work boundary-inward (onion-skin order) to propagate context gradually.
  - Patch matching proceeds via random initialisation, propagation, and random search iterations.
- The algorithm must sample from the **flattened composite of all visible layers**, not just the active layer, to provide full image context.
- The output must be a new raster layer inserted **directly above the active layer**, containing the inpainted pixels only within the selection bounds (transparent outside the selection).
- After the operation completes, the new fill layer must become the **active layer**.
- The selection must be **preserved** after the operation.
- **Content-Aware Delete** must additionally erase (make transparent) the selected pixels on the active layer.
- Both operations must be implemented as a **single atomic undoable action**.
- Both operations must display a **progress indicator** during computation.
- If the selection is **smaller than 4 pixels in any dimension**, the operation must be aborted and an error toast displayed.
- If the **WASM module is not ready**, the operation must be aborted and an error toast displayed.

---

## Acceptance Criteria

- **Edit → Content-Aware Delete** is present in the menu and disabled when no selection exists; enabled when a selection is active.
- **Edit → Content-Aware Fill** is present in the menu and disabled when no selection exists; enabled when a selection is active.
- Pressing **Shift+Delete** (or **Shift+Backspace**) with an active selection triggers Content-Aware Delete.
- After Content-Aware Delete completes, the selected region on the active layer is fully transparent, and a new layer above it contains the inpainted fill for that region.
- After Content-Aware Fill completes, the active layer is unchanged, and a new layer above it contains the inpainted fill for the selected region.
- The inpainted fill is visually coherent with the surrounding image (colours and textures blend from outside the selection boundary).
- The fill layer contains pixels only within the selection bounds; pixels outside the selection are transparent on the fill layer.
- The new fill layer is selected (active) upon completion.
- The original selection remains active (unchanged) after either operation.
- A progress indicator is visible during computation.
- Undoing Content-Aware Delete restores the erased pixels on the original layer and removes the fill layer in a single undo step.
- Undoing Content-Aware Fill removes the fill layer in a single undo step.
- Selecting a region smaller than 4×4 pixels and invoking either operation shows an error toast and makes no changes.
- If the WASM module has not loaded, invoking either operation shows an error toast and makes no changes.

---

## Edge Cases & Constraints

- **Very small selections** (less than 4px in either dimension): operation is rejected with an error toast; no layers are modified.
- **WASM not ready**: if the WASM module has not finished loading, the operation is rejected with an error toast.
- **Performance**: the WASM computation may take several seconds on large images or large selections. The UI remains responsive during this time via the progress indicator. There is no user-visible cancellation in the first version.
- **Source sampling**: the fill algorithm composites all visible layers to determine the source context. Hidden layers do not contribute to the fill.
- **First-version scope**: there is no dialog for configuring source region constraints, sampling area, or algorithm parameters — the operation is fully automatic.
- **Single active layer**: only the pixels on the currently active layer are erased in Content-Aware Delete. Other layers are not modified.
- **Transparency on active layer**: erased pixels become fully transparent; they do not blend with layers below.
- **Cross-document operations**: not supported. Both operations act only within the current document.

---

## Out of Scope

- Content-Aware Fill panel or dialog for controlling source region sampling (Photoshop CS6+ style).
- Content-Aware Scale.
- Content-Aware Move.
- Cross-document fill operations.
- User-configurable patch size or algorithm parameters.

---

## Related Features

- [Selection tools](../specifications/) — lasso, marquee, magic wand; required to define the fill region.
- [Adjustment menu](adjustment-menu.md) — Edit menu structure context.
- [Filters menu](filters-menu.md) — parallel pattern for destructive operations with progress feedback.
- Undo / redo — standard history system; both operations snapshot before execution.
