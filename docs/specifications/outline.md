# Outline

## Overview

**Outline** is a non-destructive adjustment layer that draws a solid-color stroke around the visible content of its parent layer. Only pixels with non-zero alpha contribute to the silhouette — fully transparent pixels are ignored and produce no stroke. The stroke is composited behind the parent layer's pixels so the source content always occludes any overlap, making it impossible for the outline to paint over the content it surrounds. Because it is an adjustment layer, the effect is fully reversible and re-editable at any time without modifying the underlying pixel data. Outline is categorized as a **Real-time Effect** and appears in the **Effects** menu, alongside Bloom, Drop Shadow, Glow, Chromatic Aberration, Halation, and Color Key.

## User Interaction

1. The user selects a pixel layer, text layer, or shape layer in the Layer Panel.
2. The user opens the **Effects** menu in the top menu bar and clicks **Outline…**. The item is disabled when no eligible layer is active.
3. A new child adjustment layer named **"Outline"** appears in the Layer Panel, indented immediately beneath the active layer. The **Outline** panel opens, anchored to the upper-right corner of the canvas.
4. The panel exposes the following controls:
   - **Color** — an RGBA color swatch (default: opaque red, `#FF0000FF`). Clicking it opens a color picker with an alpha channel. The color fills the stroke uniformly.
   - **Opacity** — labeled slider and numeric input (0–100%, default 100%). Scales the stroke's overall transparency on top of the color's own alpha. This is the primary opacity control.
   - **Thickness** — labeled slider and integer numeric input (1–100 px, default 3). Defines the stroke width in pixels. Only integer values are accepted; non-integer input is rounded to the nearest integer.
   - **Position** — a dropdown with three options:
     - **Outside** (default) — the stroke grows outward from the content boundary. The source content silhouette is untouched; the stroke appears exclusively around the exterior edge.
     - **Inside** — the stroke grows inward from the content boundary. The stroke appears inside the content edges; on small or narrow shapes, a thick inside stroke may fill the shape entirely.
     - **Center** — the stroke is split equally on both sides of the boundary: half the thickness outside, half inside.
   - **Softness** — labeled slider and numeric input (0–50 px, default 0). Gaussian blur radius applied to the stroke mask before colorizing and compositing. At 0 the stroke edges are crisp and hard; higher values progressively feather the stroke, producing a soft, anti-aliased border.
5. Adjusting any control updates the canvas preview in real time.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, regardless of how many controls were adjusted during the session.
7. To revise the effect later, the user clicks the **"Outline"** adjustment layer row in the Layer Panel. The panel reopens at the previously committed values.
8. The adjustment layer can be hidden (eye icon) to temporarily suppress the outline without deleting settings, or deleted to remove the effect permanently.

## Functional Requirements

- The **Outline…** menu item **must** appear in the **Effects** top-level menu.
- The item **must** be enabled only when the active layer is a pixel layer, text layer, or shape layer. It **must** be disabled when the active layer is a mask layer, another adjustment layer, a layer group, or when no layer is active.
- Activating the menu item **must** create a new child adjustment layer parented to the active layer and immediately open the Outline panel. The parent layer's pixel data **must not** be modified.
- The adjustment layer **must** be stored non-destructively: parameters are saved on the layer record and applied at render time.
- The Outline parameter set **must not** include X/Y Offset, Blend Mode, or Knockout controls. The stroke is always composited using Normal blend mode, always positioned relative to the source silhouette (no directional shift), and always rendered behind the source content.
- The panel **must** expose the following controls, each with a slider (where applicable) and a numeric input that remain in sync:
  - **Color**: RGBA color picker. Default `#FF0000FF` (opaque red). Any valid RGBA value is accepted.
  - **Opacity**: range 0–100%, default 100%. Values outside the range are clamped.
  - **Thickness**: range 1–100 px, default 3. Integer values only; non-integer input is rounded to the nearest integer. Values below 1 are clamped to 1; values above 100 are clamped to 100.
  - **Position**: dropdown with options **Outside**, **Inside**, **Center**. Default **Outside**.
  - **Softness**: range 0–50 px, default 0. Values below 0 are clamped to 0; values above 50 are clamped to 50.
- The outline **must** be computed using the following pipeline:
  1. **Extract alpha** — read the alpha channel of the composited parent layer content to produce a greyscale silhouette mask (pixel alpha 0–255).
  2. **Expand or erode** — apply morphological operations according to the selected Position:
     - **Outside**: dilate the silhouette outward by `thickness` pixels to produce the outer boundary.
     - **Inside**: erode the silhouette inward by `thickness` pixels to produce the inner boundary.
     - **Center**: dilate by `ceil(thickness / 2)` pixels and erode by `floor(thickness / 2)` pixels.
  3. **Derive the stroke mask** from the morphological result:
     - **Outside**: `stroke_mask = dilated − original` (pixels gained by dilation, excluding the original interior).
     - **Inside**: `stroke_mask = original − eroded` (pixels removed by erosion, representing the inner band).
     - **Center**: `stroke_mask = dilated − eroded` (the symmetric band spanning both sides of the original boundary).
  4. **Soften** — apply a Gaussian blur with radius equal to the Softness value to the stroke mask, feathering its edges. When Softness = 0 this step is a no-op.
  5. **Colorize** — multiply the softened mask by the selected color. The final per-pixel stroke alpha = `mask_alpha × color.alpha × (opacity / 100)`.
  6. **Composite under source** — render the colorized stroke below the parent layer's pixels using Normal blend mode (Porter-Duff over). Because the stroke is always composited behind the source, the source content naturally occludes any inside-stroke overlap without a separate knockout mask.
- The canvas preview **must** update in real time while any control is being adjusted, without perceptible lag on typical image sizes.
- Closing the panel **must** record exactly one undo history entry. Pressing Ctrl+Z / Cmd+Z once **must** remove the Outline adjustment layer and restore the canvas to its pre-outline state.
- The adjustment layer **must** support:
  - **Visibility toggle** — hiding the layer suppresses the outline without deleting it or its settings.
  - **Deletion** — permanently removes the adjustment layer and restores the underlying appearance.
  - **Re-editing** — clicking the layer row in the Layer Panel reopens the panel with the last committed parameter values.
- The adjustment layer's visibility and rendering **must** honor the parent layer's own state:
  - If the parent layer's **visibility** is off, the outline **must not** be rendered (no stroke without visible source content).
  - The parent layer's **opacity** scales the effective alpha of the source content used to derive the silhouette mask. A parent layer at 50% opacity produces a stroke whose mask alpha is at most 50%, multiplied further by the outline's own Opacity parameter.
  - The outline's Opacity parameter is independent of the parent's opacity and applies on top of it.
- The outline **must** be clipped to the canvas boundary. No part of the stroke extends or bleeds outside the canvas edges.
- If a selection is active when the Outline adjustment layer is created, the outline **must** be restricted to the selected area; the selection mask is baked into the adjustment layer at creation time and does not update if the selection changes later.

## Acceptance Criteria

- With a pixel, text, or shape layer active, **Effects → Outline…** is enabled and creates a child adjustment layer named "Outline" + opens the panel.
- With a mask layer, adjustment layer, layer group, or no active layer, the menu item is grayed out and produces no action.
- The Outline panel contains no X Offset, Y Offset, Blend Mode, or Knockout control.
- The panel opens with Color = `#FF0000FF`, Opacity = 100%, Thickness = 3, Position = Outside, Softness = 0.
- The parent layer's raw pixel data is unchanged after creating the Outline adjustment (verifiable by reading raw pixel values before and after).
- With default parameters on a pixel layer containing opaque content, a crisp 3-pixel red stroke appears around and outside the source silhouette, with no stroke visible inside the source's own opaque pixels.
- Fully transparent pixels in the source layer produce no stroke.
- Setting Opacity to 0% produces no visible outline, regardless of color, thickness, or position.
- With Position = **Outside** and Thickness = 10, the stroke occupies the 10-pixel band immediately outside the source silhouette and does not overlap the source content.
- With Position = **Inside** and Thickness = 10, the stroke occupies the 10-pixel band immediately inside the source silhouette and is fully occluded by the source content (since the stroke is composited behind).
- With Position = **Center** and Thickness = 10, a 5-pixel band outside and a 5-pixel band inside the source boundary are filled with the stroke color; the inside portion is occluded by the source content.
- Increasing Softness from 0 to 25 progressively feathers the stroke edge from a hard boundary to a diffuse, anti-aliased border.
- At Softness = 0, the stroke is pixel-crisp with no anti-aliasing.
- Setting Thickness = 1 produces the thinnest possible 1-pixel stroke.
- Entering Thickness = 0 clamps to 1; entering Thickness = 200 clamps to 100; entering Softness = 60 clamps to 50; entering Opacity = 120 clamps to 100.
- Entering a non-integer thickness value (e.g., 3.7) rounds to the nearest integer (4) and is reflected in the numeric input.
- Changing the Color to opaque blue (`#0000FFFF`) produces a blue stroke uniformly around the source content.
- The color alpha and Opacity slider combine multiplicatively: a color at 50% alpha with Opacity = 50% produces a stroke at 25% of its maximum visibility.
- Hiding the Outline adjustment layer removes the stroke from the canvas preview without affecting the parent layer.
- Deleting the Outline adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the Outline adjustment layer entirely.
- Clicking the Outline adjustment layer row reopens the panel showing all previously committed parameter values.
- Creating with an active selection restricts the outline to that area; pixels outside the selection boundary produce no stroke.
- A parent layer at 30% opacity produces an outline that is visibly lighter than the same outline on a layer at 100% opacity (mask alpha attenuated by parent opacity).
- The outline is clipped at the canvas boundary — no stroke content appears outside the canvas edges.
- The outline is flat and uniform in color; there is no gradient, glow, or luminance variation within the stroke area.

## Edge Cases & Constraints

- **Inside stroke on small or narrow shapes**: when Thickness equals or exceeds half the narrowest dimension of the source content, the inside stroke may fill the entire shape. This is expected — the stroke grows inward until the eroded silhouette is empty, resulting in a filled shape. No error is raised.
- **Center stroke rounding**: when Thickness is odd, Center position allocates `ceil(thickness / 2)` pixels outward and `floor(thickness / 2)` pixels inward, producing an asymmetric split by one pixel. This is by design; the user can switch to Outside or Inside for a fully symmetric result.
- **Softness interaction with thin strokes**: applying a high Softness value (e.g., 40 px) to a thin stroke (Thickness 1–3 px) will cause the stroke alpha to be spread very thinly, possibly making it nearly invisible. This is expected feathering behavior.
- **Stroke visibility when source is fully opaque**: for the Outside and Center positions the stroke extends beyond the source boundary and will be visible. For Inside, the stroke is entirely behind opaque source pixels and is not visible. The adjustment layer is still created and its settings preserved.
- **Composite order**: the outline is always composited as Normal blend mode immediately behind the parent layer content. There is no option to change the blend mode or composite the stroke above the source. If a different compositing behavior is needed, a Glow or Drop Shadow adjustment layer may be more appropriate.
- **Multiple outlines**: multiple Outline adjustment layers may be stacked on the same parent layer, each with independent settings (e.g., a thick soft outside stroke plus a thin crisp inside highlight). They composite independently.
- **Interaction with Drop Shadow and Glow**: when an Outline is stacked alongside Drop Shadow or Glow on the same parent, each effect composites behind the source independently. The order of the adjustment layers in the Layer Panel determines which effect is furthest behind; the effect listed lower in the panel is composited first and may be partially occluded by effects listed above it.
- **Selection mask is static**: the selection mask baked at creation time does not update if the selection changes later.
- **No keyboard shortcut** is assigned to this effect by default.
- Softness values are in pixels at the image's **full native resolution**. On high-resolution canvases, the same Softness value produces a proportionally finer feather visually than on a small canvas.
- The outline is derived from the **composited** content of the parent layer — adjustment layers applied below the Outline layer (e.g., a Brightness/Contrast child of the same parent) are included in the source alpha computation.
- Thickness values are always integers and represent physical pixels at native canvas resolution, not display pixels. Zoom level does not affect the rendered stroke width.

## Related Features

- [drop-shadow.md](drop-shadow.md) — closely related real-time effect; shares the "composite behind source" approach but adds X/Y offset, Spread, Softness up to 100 px, and a Blend Mode selector. Drop Shadow is appropriate when a directional shadow is needed; Outline is the right choice for a uniform border.
- [glow.md](glow.md) — real-time effect that radiates a soft halo centered on the source content; Glow includes a Blend Mode and Knockout option and uses Spread + Softness rather than a discrete Thickness value, making it better suited for luminous, diffuse borders.
- [bloom.md](bloom.md) — real-time glow derived from luminance rather than layer alpha; unrelated to silhouette-based outlining.
- [adjustment-menu.md](adjustment-menu.md) — architecture of the Effects/Adjustments menu system that hosts Outline.
- [color-key.md](color-key.md) — real-time effect that modifies layer alpha, which affects the silhouette used to derive the outline mask.
- [layer-groups.md](layer-groups.md) — layer nesting model that child adjustment layers follow.
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — the compositing pipeline that must include Outline for flatten/merge/export.
