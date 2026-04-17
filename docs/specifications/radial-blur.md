# Radial Blur

## Overview

**Radial Blur** is a destructive filter that smears the pixels of the active pixel layer along either concentric arcs (Spin mode) or radial lines (Zoom mode) emanating from a user-defined center point. Spin mode simulates camera or subject rotation; Zoom mode simulates a camera zooming in or out. Like all Filters menu entries, the effect is baked directly into the layer's pixel data upon confirmation and is undoable via the standard undo history. The reference design closely follows Photoshop's Radial Blur filter.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user opens **Filters → Radial Blur…** from the menu bar. If the active layer is not a pixel layer, the menu item is grayed out and cannot be selected.
3. The **Radial Blur** dialog opens as a modal dialog. The canvas immediately shows the layer's current (unmodified) pixels.
4. The dialog presents:
   - A **Mode** selector with two mutually exclusive options: **Spin** and **Zoom**. Default is **Spin**.
   - An **Amount** control: integer range 1–100, default 10. Both a slider and a numeric input are present and kept in sync.
   - A **Quality** selector with three options: **Draft**, **Good**, **Best**. Default is **Good**.
   - A **Center picker** — a small rectangular widget inside the dialog that displays a grid of diagonal lines (similar to Photoshop's abstract radial blur preview). A crosshair marks the current blur center position. The user clicks or drags anywhere inside this widget to reposition the center. The center defaults to the center of the canvas (50%, 50%).
5. As the user adjusts any control, a blurred preview appears on the canvas after a short debounce delay. A spinner indicator is shown while the preview is being computed. The dialog remains open throughout.
6. The user clicks **Apply** to commit the effect, or clicks **Cancel** or presses Escape to discard the preview and leave the layer unchanged.

### Mode behavior

- **Spin** — each pixel is smeared along a circular arc centered on the blur center. The smear arc length increases with distance from the center; pixels at the center itself are not blurred. Amount maps to a rotation angle: Amount = 1 corresponds to approximately 0.1° and Amount = 100 corresponds to approximately 10.0°.
- **Zoom** — each pixel is smeared radially inward and outward from the blur center along a straight line through the center. A higher Amount increases the number of radial sample steps, producing longer trailing streaks.

## Functional Requirements

- The **Radial Blur…** menu item **must** appear under **Filters** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, group, or no layer selected).
- The dialog **must** be modal — the menu bar and canvas **must not** be interactive while it is open.
- The dialog **must** expose a **Mode** control with exactly two options: **Spin** and **Zoom**. Default **must** be **Spin**.
- The dialog **must** expose an **Amount** control: integer range 1 to 100 (inclusive), default 10. Both a slider and a numeric input **must** be present and kept in sync. Values entered outside the allowed range **must** be clamped: values below 1 set to 1; values above 100 set to 100.
- In **Spin** mode, Amount **must** map to a rotation angle: Amount = 1 ≈ 0.1°, Amount = 100 ≈ 10.0°. Pixels further from the center travel a longer arc and appear more blurred than pixels close to the center.
- In **Zoom** mode, Amount **must** control the number of radial sample steps taken from each pixel. Higher Amount produces longer radial streaks.
- The dialog **must** expose a **Quality** selector with exactly three options: **Draft**, **Good**, **Best**. Default **must** be **Good**.
  - **Draft** — fewest samples; fast computation; visible banding or stepping artifacts are acceptable.
  - **Good** — moderate samples; balanced quality and performance.
  - **Best** — maximum samples; sub-pixel interpolation; smooth, anti-aliased output.
- The dialog **must** expose a **Center picker** — a miniature rectangular widget showing a grid of diagonal lines with a crosshair indicating the current center. The user **must** be able to click or drag anywhere within the widget to set the center position. The center **must** default to 50%, 50% (canvas center).
- The canvas **must** display a live preview while the dialog is open. This preview **must** be debounced — it updates only after the user has settled on a value, not on every incremental input event.
- A spinner indicator **must** be visible on the dialog while preview computation is in progress.
- The preview **must** faithfully reflect the blur as it will appear when applied. It **must not** affect the layer's actual pixel data until the user clicks **Apply**.
- Clicking **Apply** **must** permanently write the blurred pixels back to the active layer, close the dialog, and record exactly one undo history entry labeled **"Radial Blur"**. Ctrl+Z / Cmd+Z **must** restore the layer's pixel data to its exact pre-blur state.
- Clicking **Cancel** or pressing Escape **must** close the dialog, restore the canvas to its pre-dialog appearance, and record no undo history entry.
- If an active selection exists, only pixels within the selection boundary **must** be blurred; pixels outside the selection **must** remain unmodified. The selection boundary is evaluated at the moment **Apply** is clicked.
- If no active selection exists, the blur **must** be applied to every pixel on the active layer.
- The blur **must not** affect any layer other than the currently active pixel layer.

## Acceptance Criteria

- With a pixel layer active, **Filters → Radial Blur…** is enabled and opens the modal dialog.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- The dialog opens with Mode set to **Spin**, Amount set to **10**, and Quality set to **Good**.
- The center crosshair in the center picker is initially positioned at the center of the widget (representing 50%, 50%).
- Clicking a corner of the center picker repositions the crosshair to that corner and triggers a debounced preview update.
- Dragging within the center picker continuously repositions the crosshair; the preview updates after the drag settles.
- Switching from **Spin** to **Zoom** (or vice versa) updates the preview to reflect the new mode.
- The Amount slider moves between 1 and 100; typing 0 clamps to 1; typing 150 clamps to 100.
- After the user stops adjusting any control, the canvas shows the blurred preview within the debounce window; a spinner is visible during computation.
- The canvas does not update on every pixel of slider drag — it waits for the user to settle.
- Selecting **Draft** quality produces a fast preview with visible stepping; **Best** produces a smooth, anti-aliased result.
- In Spin mode, a higher Amount produces visibly wider rotational arcs in the preview.
- In Zoom mode, a higher Amount produces visibly longer radial streaks in the preview.
- In Spin mode with center at 50%, 50%, pixels far from the center are more blurred than pixels near the center.
- In Zoom mode, streaks emanate visibly from the center crosshair position.
- Clicking **Apply** modifies the layer's pixel data and closes the dialog; the undo history shows the entry "Radial Blur".
- Clicking **Cancel** leaves the layer's pixel data byte-for-byte identical to its pre-dialog state.
- Pressing Escape while the dialog is open produces the same result as clicking **Cancel**.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** restores the layer's pixel data exactly to its pre-blur state.
- With an active selection, **Apply** blurs only pixels inside the selection; pixels outside are unchanged.
- With no active selection, **Apply** blurs the entire layer.

## Edge Cases & Constraints

- An Amount of 1 produces a minimal, near-imperceptible blur. It is a valid input and must be applied without error.
- In Spin mode, pixels exactly at the blur center are not smeared (zero arc radius), so the center point itself remains unblurred regardless of Amount.
- In Zoom mode, pixels exactly at the blur center have no directional vector and are unblurred; pixels immediately adjacent will show a visible radial streak.
- Moving the blur center to a corner or edge of the canvas is valid. Spin arcs and Zoom streaks that extend beyond the canvas boundary are clipped.
- An Amount of 100 at Best quality on a large canvas is computationally expensive. The debounce limits unnecessary preview computation; the Apply step may take noticeable time but the dialog closes promptly after completion. No separate progress bar is shown during Apply.
- Fully transparent pixels are included in the blur computation; the operation may spread partial alpha into previously transparent areas — this is expected behavior consistent with other blur filters.
- Applying Radial Blur to a fully transparent layer is valid and produces no visible change, but still records one undo history entry when **Apply** is clicked.
- Radial Blur is **not** re-editable after commit. Once applied, the original pixel data cannot be recovered except via undo.

## Out of Scope

- **Non-destructive radial blur** — a blur filter layer that stores parameters and re-renders on compositing is a separate, future feature.
- **Applying blur to multiple layers simultaneously** — the filter always targets the single active pixel layer.
- **Applying Radial Blur to non-pixel layers** (group layers, adjustment layers) — the menu item is disabled in those contexts.
- **Ring mode** — a third radial blur variant that blurs pixels along concentric rings is not included.
- **Real-time preview on every input event** — preview is intentionally debounced; sub-frame continuous updates are out of scope.
- **Numeric entry of the center position** — the center is set exclusively via the click/drag center picker widget; text fields for X/Y percentage are not provided.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu that hosts this item and defines the shared enable/disable rules
- [gaussian-blur.md](gaussian-blur.md) — sibling destructive blur filter; shares the same modal dialog pattern and debounced preview mechanism
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline used when a selection is active to isolate which pixels are modified
