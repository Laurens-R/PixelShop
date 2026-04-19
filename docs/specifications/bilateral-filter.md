# Bilateral Filter

## Overview

**Bilateral Filter** is a destructive edge-preserving smoothing filter that reduces noise and fine texture while keeping hard boundaries between regions of different color intact. Where a Gaussian blur weights neighboring pixels by spatial distance alone — and therefore blurs across edges — the bilateral filter additionally weights each neighbor by how similar its color is to the center pixel. Pixels across a strong color edge contribute very little, so the edge remains sharp while flat-color or low-contrast regions are smoothed. The operation is undoable via the standard undo history.

## User Interaction

1. The user ensures the target pixel layer is active in the Layer Panel.
2. The user selects **Filters → Noise → Bilateral…** from the menu bar. If the active layer is not a pixel layer, the menu item is grayed out and cannot be selected.
3. The **Bilateral Filter** floating panel opens to the right of the canvas. The canvas shows the layer's current unmodified pixels.
4. The panel presents two controls:
   - **Spatial Radius** — integer slider and numeric input, range 1–20 (px), default 5. Determines how far from the center pixel the filter looks for neighbors to include in the weighted average. Higher values smooth over larger areas.
   - **Color Sigma** — integer slider and numeric input, range 1–150, default 25. Controls how much color difference is tolerated between the center pixel and a neighbor before that neighbor's contribution drops off. Lower values preserve finer color transitions; higher values allow smoothing across broader color ranges.
5. As the user adjusts either control, a filtered preview appears on the canvas after a short debounce delay — not on every pixel of movement. The panel remains open during preview.
6. If an active selection is present, a note in the panel indicates that the filter will apply only within the selected area.
7. While the preview is being computed, a busy spinner is shown inside the panel.
8. The user clicks **Apply** to commit the filter, or **Cancel** (or presses Escape) to discard the preview and leave the layer unchanged.

## Functional Requirements

- The **Bilateral…** menu item **must** appear under **Filters → Noise** in the menu bar. It **must** be disabled when the active layer is not a pixel layer (adjustment layer, mask, text, shape, or no layer selected).
- The panel **must** expose a **Spatial Radius** control: integer range 1 to 20 (inclusive), default 5. Both a slider and a numeric input **must** be present and kept in sync.
- The panel **must** expose a **Color Sigma** control: integer range 1 to 150 (inclusive), default 25. Both a slider and a numeric input **must** be present and kept in sync.
- Values entered outside each allowed range **must** be clamped to the nearest boundary.
- The canvas **must** display a live filtered preview while the panel is open. This preview **must** be debounced — it is applied only after the user has settled on a value, not on every incremental slider movement.
- The preview **must** reflect the filter result as it will appear when applied. It **must not** affect the actual layer pixel data until the user clicks **Apply**.
- Clicking **Apply** **must** permanently write the filtered pixels back to the active layer, close the panel, and record exactly one undo history entry. Pressing Ctrl+Z (or Cmd+Z on macOS) **must** restore the layer's pixel data to its exact pre-filter state.
- Clicking **Cancel** or pressing Escape **must** close the panel, restore the canvas to its pre-panel appearance, and record no undo history entry.
- The alpha channel of every pixel **must** be preserved unchanged. The bilateral weighting and averaging are applied to the RGB channels only.
- If an active selection exists, only pixels within the selection boundary **must** be filtered; pixels outside the selection **must** remain unmodified. The selection boundary is evaluated at the moment **Apply** is clicked.
- If no active selection exists, the filter **must** be applied to every pixel on the active layer.
- The filter **must not** affect any layer other than the currently active pixel layer, even if other layers are visible.

## Acceptance Criteria

- With a pixel layer active, **Filters → Noise → Bilateral…** is enabled and opens the floating panel.
- With a non-pixel layer active (or no layer), the menu item is grayed out and clicking it does nothing.
- The Spatial Radius slider moves between 1 and 20; out-of-range typed values are clamped.
- The Color Sigma slider moves between 1 and 150; out-of-range typed values are clamped.
- After the user stops adjusting a control, the canvas updates to show a filtered preview within the debounce window.
- The canvas does not update on every pixel of slider drag — it waits for the user to settle.
- At a low Color Sigma (e.g., 5), strong edges in the layer remain visually sharp after the preview updates.
- At a high Color Sigma (e.g., 150), the result approaches an unweighted box blur and edges soften noticeably.
- Clicking **Apply** modifies the layer's pixel data and closes the panel.
- Clicking **Cancel** leaves the layer's pixel data byte-for-byte identical to its pre-panel state.
- Pressing Escape while the panel is open produces the same result as clicking **Cancel**.
- Pressing Ctrl+Z / Cmd+Z once after **Apply** restores the layer's pixel data exactly to its pre-filter state.
- The alpha channel is identical before and after applying the filter.
- With a selection active, **Apply** filters only the pixels inside the selection; pixels outside are unchanged.
- With no active selection, **Apply** filters the entire layer.

## Edge Cases & Constraints

- Spatial Radius 1 with Color Sigma 1 produces a minimal result: only very close, nearly identical neighbors contribute, resulting in virtually no change. This is a valid configuration and **must** be applied without error.
- Large Spatial Radius values (approaching 20) on high-resolution canvases are computationally expensive. The debounce on preview limits unnecessary computation.
- Pixels at the edge of the layer or at the boundary of an active selection have neighbourhoods that extend beyond available pixel data. These positions **must** be handled with border clamping — the neighbourhood is padded by repeating the nearest in-bounds pixel value.
- Applying the filter to a fully transparent layer is valid and produces no visible change, but still records an undo history entry when **Apply** is clicked.
- The Bilateral Filter panel is modal — the menu bar and canvas are not interactive while the panel is open.
- Bilateral Filter is **not** re-editable after commit. Once applied, the original pixel data cannot be recovered except via undo.

## Out of Scope

- **Separate spatial and color sigma for each RGB channel** — the same sigma values apply to all three channels uniformly.
- **Joint / cross-bilateral filtering** guided by a separate reference image is not supported.
- **Non-destructive application** — the filter always permanently modifies pixel data; a non-destructive filter layer type is a separate, future feature.
- **Applying the filter to multiple layers simultaneously** — the filter always targets the single active layer.

## Related Features

- [filters-menu.md](filters-menu.md) — the Filters menu and its **Noise** submenu that host this item
- [noise-filmgrain-lensbur-clouds.md](noise-filmgrain-lensbur-clouds.md) — the sibling Noise submenu filters (Add Noise, Film Grain, Lens Blur, Clouds)
- [median-filter.md](median-filter.md) — complementary outlier-removal denoising filter in the same submenu
- [reduce-noise.md](reduce-noise.md) — composite denoising filter in the same submenu
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline used when a selection is active to isolate which pixels are modified
