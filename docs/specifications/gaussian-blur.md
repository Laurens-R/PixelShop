# Gaussian Blur

## Overview

**Gaussian Blur** is a destructive filter that softens the pixels of the active pixel layer by applying a standard Gaussian convolution. It is designed for blurring backgrounds, reducing harsh pixel edges, or creating depth cues in pixel art compositions. Because the blur is baked directly into the layer's pixel data, it is simple and predictable — the result is exactly what the user sees, with no hidden state. The operation is undoable via the standard undo history.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user opens **Filters → Gaussian Blur…** from the menu bar. If the active layer is not a pixel layer the menu item is grayed out and cannot be selected.
3. The **Gaussian Blur** dialog opens. The canvas immediately shows the layer's current (unmodified) pixels.
4. The dialog presents a single **Radius** slider (range 1–250 px, default 2). An adjacent numeric input displays and accepts the same value.
5. As the user moves the slider, a blurred preview appears on the canvas after a short debounce delay — not on every pixel of movement. The dialog remains open during preview.
6. When the user commits a new radius value (releases the slider, tabs out of the numeric input, or stops typing), the canvas updates to show the blurred preview at that radius.
7. The user clicks **Apply** to commit the blur, or **Cancel** (or presses Escape) to discard the preview and leave the layer unchanged.

## Functional Requirements

- The **Gaussian Blur…** menu item **must** appear under **Filters** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, or no layer selected).
- The dialog **must** expose a **Radius** control: integer range 1 to 250 (inclusive), default 2. Both a slider and a numeric input **must** be present and kept in sync.
- Values entered outside the allowed range **must** be clamped: values below 1 are set to 1; values above 250 are set to 250.
- The canvas **must** display a live blurred preview while the dialog is open. This preview **must** be debounced — it is applied only after the user has settled on a value, not on every incremental slider movement.
- The preview **must** reflect the blur as it will appear when applied. It **must not** affect the actual layer pixel data until the user clicks **Apply**.
- Clicking **Apply** **must** permanently write the blurred pixels back to the active layer, close the dialog, and record exactly one undo history entry. Pressing Ctrl+Z (or Cmd+Z on macOS) **must** restore the layer's pixel data to its exact pre-blur state.
- Clicking **Cancel** or pressing Escape **must** close the dialog, restore the canvas to its pre-dialog appearance, and record no undo history entry.
- If an active selection exists, only pixels within the selection boundary **must** be blurred; pixels outside the selection **must** remain unmodified. The selection boundary is evaluated at the moment **Apply** is clicked.
- If no active selection exists, the blur **must** be applied to every pixel on the active layer.
- The blur **must not** affect any layer other than the currently active pixel layer, even if other layers are visible.

## Acceptance Criteria

- With a pixel layer active, **Filters → Gaussian Blur…** is enabled and opens the dialog.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- The Radius slider moves between 1 and 250; typing 0 clamps to 1; typing 300 clamps to 250.
- After the user stops moving the slider, the canvas updates to show a blurred preview within the debounce window.
- The canvas does not flicker or update on every pixel of slider drag — it waits for the user to settle.
- Clicking **Apply** modifies the layer's pixel data (the previously crisp pixels are now blurred) and closes the dialog.
- Clicking **Cancel** leaves the layer's pixel data byte-for-byte identical to its pre-dialog state.
- Pressing Escape while the dialog is open produces the same result as clicking **Cancel**.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** restores the layer's pixel data exactly to its pre-blur state.
- With a rectangular or freeform selection active, **Apply** blurs only the pixels inside the selection; pixels outside are unchanged.
- With no active selection, **Apply** blurs the entire layer.

## Edge Cases & Constraints

- A radius of 1 produces a minimal, near-imperceptible softening. It is a valid input and **must** be applied without error.
- A radius of 250 on a large canvas is computationally expensive. The dialog **must** remain responsive; the preview debounce helps limit unnecessary computation during rapid slider movement.
- Fully transparent pixels (alpha = 0) are included in the Gaussian convolution; the blur may spread partial alpha values into previously transparent areas at layer edges — this is expected behavior.
- Applying blur to a fully transparent layer is valid and produces no visible change, but still records an undo history entry when **Apply** is clicked.
- The Gaussian Blur dialog is modal — the menu bar and canvas are not interactive while it is open.
- There are no preset radius values. The user always specifies the radius manually.
- Gaussian Blur is **not** re-editable after commit. Once applied, the original pixel data cannot be recovered except via undo.

## Out of Scope

- **Non-destructive blur** — a blur filter layer that stores the radius and re-applies on render is a separate, future feature.
- **Per-channel blur** — applying different radii to individual color channels is not supported.
- **Motion blur, radial blur, or other blur types** — only isotropic Gaussian blur is included in this feature.
- **Applying blur to multiple layers simultaneously** — the filter always targets the single active layer.
- **Real-time preview on every slider frame** — preview is intentionally debounced; sub-frame updates are out of scope.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu that hosts this item and defines the shared enable/disable rules
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline used when a selection is active to isolate which pixels are modified
