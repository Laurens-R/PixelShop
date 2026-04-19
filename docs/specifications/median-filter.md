# Median Filter

## Overview

**Median Filter** is a destructive filter that removes salt-and-pepper and impulse noise from the active pixel layer by replacing each pixel's color with the median color value sampled from a square neighbourhood around it. Unlike a Gaussian blur, which averages all nearby pixels and softens edges, the median filter discards outliers before computing the representative value, preserving hard edges while eliminating isolated bright or dark speckles. The operation is undoable via the standard undo history.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user selects **Filters → Noise → Median…** from the menu bar. If the active layer is not a pixel layer, the menu item is grayed out and cannot be selected.
3. The **Median Filter** floating panel opens to the right of the canvas. The canvas shows the layer's current unmodified pixels.
4. The panel presents a single control:
   - **Radius** — integer slider and numeric input, range 1–10 (px), default 1. A radius of 1 samples a 3×3 neighbourhood; a radius of 10 samples a 21×21 neighbourhood.
5. As the user adjusts the Radius control, a filtered preview appears on the canvas after a short debounce delay — not on every pixel of movement. The panel remains open during preview.
6. If an active selection is present, a note in the panel indicates that the filter will apply only within the selected area.
7. While the preview is being computed, a busy spinner is shown inside the panel.
8. The user clicks **Apply** to commit the filter, or **Cancel** (or presses Escape) to discard the preview and leave the layer unchanged.

## Functional Requirements

- The **Median…** menu item **must** appear under **Filters → Noise** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, or no layer selected).
- The panel **must** expose a **Radius** control: integer range 1 to 10 (inclusive), default 1. Both a slider and a numeric input **must** be present and kept in sync.
- Values entered outside the allowed range **must** be clamped: values below 1 are set to 1; values above 10 are set to 10.
- The canvas **must** display a live filtered preview while the panel is open. This preview **must** be debounced — it is applied only after the user has settled on a value, not on every incremental slider movement.
- The preview **must** reflect the filter result as it will appear when applied. It **must not** affect the actual layer pixel data until the user clicks **Apply**.
- Clicking **Apply** **must** permanently write the filtered pixels back to the active layer, close the panel, and record exactly one undo history entry. Pressing Ctrl+Z (or Cmd+Z on macOS) **must** restore the layer's pixel data to its exact pre-filter state.
- Clicking **Cancel** or pressing Escape **must** close the panel, restore the canvas to its pre-panel appearance, and record no undo history entry.
- The alpha channel of every pixel **must** be preserved unchanged. The median operation is applied to the RGB channels only.
- If an active selection exists, only pixels within the selection boundary **must** be filtered; pixels outside the selection **must** remain unmodified. The selection boundary is evaluated at the moment **Apply** is clicked.
- If no active selection exists, the filter **must** be applied to every pixel on the active layer.
- The filter **must not** affect any layer other than the currently active pixel layer, even if other layers are visible.

## Acceptance Criteria

- With a pixel layer active, **Filters → Noise → Median…** is enabled and opens the floating panel.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- The Radius slider moves between 1 and 10; typing 0 clamps to 1; typing 15 clamps to 10.
- After the user stops moving the slider, the canvas updates to show a filtered preview within the debounce window.
- The canvas does not update on every pixel of slider drag — it waits for the user to settle.
- Clicking **Apply** modifies the layer's pixel data and closes the panel. Isolated bright or dark outlier pixels are removed.
- Clicking **Cancel** leaves the layer's pixel data byte-for-byte identical to its pre-panel state.
- Pressing Escape while the panel is open produces the same result as clicking **Cancel**.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** restores the layer's pixel data exactly to its pre-filter state.
- The alpha channel is identical before and after applying the filter.
- With a rectangular or freeform selection active, **Apply** filters only the pixels inside the selection; pixels outside are unchanged.
- With no active selection, **Apply** filters the entire layer.

## Edge Cases & Constraints

- A radius of 1 (3×3 neighbourhood) produces the mildest result. It is a valid input and **must** be applied without error.
- At the maximum radius of 10, the 21×21 neighbourhood sampling is computationally intensive on large canvases. The debounce on preview limits unnecessary computation during rapid slider movement.
- Pixels at the edge of the layer (or at the edge of an active selection) have a neighbourhood that extends beyond the available pixel data. These edge pixels **must** be handled with border clamping — the neighbourhood is padded by repeating the nearest in-bounds pixel value.
- Applying the filter to a fully transparent layer is valid and produces no visible change, but still records an undo history entry when **Apply** is clicked.
- The Median Filter panel is modal — the menu bar and canvas are not interactive while the panel is open.
- Median Filter is **not** re-editable after commit. Once applied, the original pixel data cannot be recovered except via undo.

## Out of Scope

- **Per-channel radius** — applying different radii to individual RGB channels is not supported.
- **Non-square neighbourhoods** — only a square (2r+1 × 2r+1) neighbourhood shape is supported; circular or cross-shaped kernels are not.
- **Non-destructive application** — the filter always permanently modifies pixel data; a non-destructive filter layer type is a separate, future feature.
- **Applying the filter to multiple layers simultaneously** — the filter always targets the single active layer.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu and its **Noise** submenu that host this item
- [noise-filmgrain-lensbur-clouds.md](noise-filmgrain-lensbur-clouds.md) — the sibling Noise submenu filters (Add Noise, Film Grain, Lens Blur, Clouds)
- [bilateral-filter.md](bilateral-filter.md) — complementary edge-preserving denoising filter in the same submenu
- [reduce-noise.md](reduce-noise.md) — composite denoising filter in the same submenu
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline used when a selection is active to isolate which pixels are modified
