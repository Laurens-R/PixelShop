# Drop Shadow

## Overview

**Drop Shadow** is a non-destructive adjustment layer that projects a soft, offset shadow from the visible content of its parent layer. Only pixels with non-zero alpha cast a shadow — fully transparent pixels are invisible and contribute nothing. The shadow is composited behind the parent layer's pixels, so it is naturally occluded where the parent is opaque and visible where the parent is transparent. Because it is an adjustment layer, the effect is fully reversible and re-editable at any time without modifying the underlying pixel data. Drop Shadow is categorized as a **Real-time Effect** and appears in the **Effects** menu, alongside Bloom, Chromatic Aberration, Halation, and Color Key.

## User Interaction

1. The user selects a pixel layer, text layer, or shape layer in the Layer Panel.
2. The user opens the **Effects** menu in the top menu bar and clicks **Drop Shadow…**. The item is disabled when no eligible layer is active.
3. A new child adjustment layer named **"Drop Shadow"** appears in the Layer Panel, indented immediately beneath the active layer. The **Drop Shadow** panel opens, anchored to the upper-right corner of the canvas.
4. The panel exposes the following controls:
   - **Color** — an RGBA color swatch (default: opaque black, #000000FF). Clicking it opens a color picker with an alpha channel. The color defines the hue and base transparency of the shadow.
   - **Opacity** — labeled slider and numeric input (0–100%, default 75%). Scales the shadow's overall transparency on top of the color's own alpha. This is the primary opacity control.
   - **X Offset** — labeled numeric input with increment/decrement arrows (−200 to +200 px, default 5). Shifts the shadow horizontally. Positive values move the shadow right; negative values move it left.
   - **Y Offset** — labeled numeric input with increment/decrement arrows (−200 to +200 px, default 5). Shifts the shadow vertically. Positive values move the shadow down; negative values move it up.
   - **Spread** — labeled slider and numeric input (0–100 px, default 0). Expands the shadow's alpha silhouette outward before blurring, widening the shadow boundary. At 0 the shadow matches the source silhouette exactly.
   - **Softness** — labeled slider and numeric input (0–100 px, default 10). The Gaussian blur radius applied to the spread shadow mask. At 0 the shadow edges are hard; higher values produce a progressively softer, more diffuse shadow.
   - **Blend Mode** — a dropdown (default: Multiply). Controls how the shadow composites with the layers below it. Common options include Multiply, Normal, and Screen.
   - **Knockout** — a checkbox (default: on). When enabled, the source layer's own opaque pixels occlude the shadow beneath them, so the shadow is only visible around and outside the source content. When disabled, the shadow is visible even beneath the source layer's own pixels.
5. Adjusting any control updates the canvas preview in real time.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, regardless of how many controls were adjusted during the session.
7. To revise the effect later, the user clicks the **"Drop Shadow"** adjustment layer row in the Layer Panel. The panel reopens at the previously committed values.
8. The adjustment layer can be hidden (eye icon) to temporarily suppress the shadow without deleting settings, or deleted to remove the effect permanently.

## Functional Requirements

- The **Drop Shadow…** menu item **must** appear in the **Effects** top-level menu.
- The item **must** be enabled only when the active layer is a pixel layer, text layer, or shape layer. It **must** be disabled when the active layer is a mask layer, another adjustment layer, a layer group, or when no layer is active.
- Activating the menu item **must** create a new child adjustment layer parented to the active layer and immediately open the Drop Shadow panel. The parent layer's pixel data **must not** be modified.
- The adjustment layer **must** be stored non-destructively: parameters are saved on the layer record and applied at render time.
- The panel **must** expose the following controls, each with a slider (where applicable) and a numeric input that remain in sync:
  - **Color**: RGBA color picker. Default `#000000FF` (opaque black). No clamping needed; any valid RGBA value is accepted.
  - **Opacity**: range 0–100%, default 75%. Values outside the range are clamped.
  - **X Offset**: range −200 to +200 px, default 5. Integer or floating-point values are accepted; values outside the range are clamped.
  - **Y Offset**: range −200 to +200 px, default 5. Same clamping rule as X Offset.
  - **Spread**: range 0–100 px, default 0. Values below 0 are clamped to 0; values above 100 are clamped to 100.
  - **Softness**: range 0–100 px, default 10. Same clamping rule as Spread.
  - **Blend Mode**: dropdown selector. Default Multiply. Must include at least: Normal, Multiply, Screen.
  - **Knockout**: checkbox. Default enabled (checked).
- The shadow **must** be computed using the following pipeline:
  1. **Extract alpha** — read the alpha channel of the composited parent layer content to produce a greyscale silhouette mask (pixel alpha 0–255).
  2. **Expand by Spread** — grow the silhouette outward by the Spread value using morphological dilation (or equivalent), producing a wider shadow boundary. When Spread = 0 this step is a no-op.
  3. **Gaussian blur** — apply a Gaussian blur with radius equal to the Softness value to the expanded mask, softening its edges. When Softness = 0 this step is a no-op.
  4. **Colorize** — multiply the blurred mask by the selected shadow color. The final per-pixel shadow alpha = `mask_alpha × color.alpha × (opacity / 100)`.
  5. **Offset** — shift the colorized shadow by (X Offset, Y Offset) pixels. Shifted pixels that fall outside the canvas boundary are clipped and discarded.
  6. **Composite under source** — render the shadow layer below the parent layer's pixels in the compositing order, using the selected Blend Mode. When Knockout is enabled, the shadow is additionally masked by the inverse of the parent layer's own alpha so that the source content fully occludes the shadow beneath it. When Knockout is disabled, the shadow is visible through the parent layer's transparent regions but may also be partially visible under semi-transparent pixels depending on their alpha.
- The canvas preview **must** update in real time while any control is being adjusted, without perceptible lag on typical image sizes.
- Closing the panel **must** record exactly one undo history entry. Pressing Ctrl+Z / Cmd+Z once **must** remove the Drop Shadow adjustment layer and restore the canvas to its pre-shadow state.
- The adjustment layer **must** support:
  - **Visibility toggle** — hiding the layer suppresses the shadow without deleting it or its settings.
  - **Deletion** — permanently removes the adjustment layer and restores the underlying appearance.
  - **Re-editing** — clicking the layer row in the Layer Panel reopens the panel with the last committed parameter values.
- The adjustment layer's visibility and rendering **must** honor the parent layer's own state:
  - If the parent layer's **visibility** is off, the shadow **must not** be rendered (no shadow without visible source content).
  - The parent layer's **opacity** scales the effective alpha of the source content used to derive the shadow mask. A parent layer at 50% opacity produces a shadow whose mask alpha is at most 50%, multiplied further by the shadow's own Opacity parameter.
  - The shadow's Opacity parameter is independent of the parent's opacity and applies on top of it.
- The shadow **must** be clipped to the canvas boundary. No part of the shadow extends or bleeds outside the canvas edges.
- If a selection is active when the Drop Shadow adjustment layer is created, the shadow **must** be restricted to the selected area; the selection mask is baked into the adjustment layer at creation time and does not update if the selection changes later.

## Acceptance Criteria

- With a pixel, text, or shape layer active, **Effects → Drop Shadow…** is enabled and creates a child adjustment layer + opens the panel.
- With a mask layer, adjustment layer, layer group, or no active layer, the menu item is grayed out and produces no action.
- The parent layer's raw pixel data is unchanged after creating the Drop Shadow adjustment (verifiable by reading raw pixel values before and after).
- With default parameters (Opacity 75%, X/Y Offset 5/5, Spread 0, Softness 10, Multiply, Knockout on), a visible shadow appears offset to the lower-right of the source content on a pixel layer containing opaque content.
- Fully transparent pixels in the source layer cast no shadow.
- Setting Opacity to 0% produces no visible shadow, regardless of color, spread, or softness.
- Setting both X Offset and Y Offset to 0, Spread to 0, and Softness to 0 produces a hard shadow exactly aligned with the source silhouette, fully hidden behind opaque source pixels when Knockout is on.
- Increasing Softness from 0 to 50 progressively softens the shadow edge from a hard cutout to a diffuse feathered shape.
- Increasing Spread from 0 to 50 visibly widens the shadow silhouette beyond the source content boundary, even before blurring.
- Setting X Offset to −50 moves the shadow to the left of the source content; setting Y Offset to −50 moves it above.
- With Knockout off, the shadow is visible beneath the source content's own pixels (the shadow bleeds through semi-transparent areas of the source).
- With Knockout on, the shadow is occluded wherever the source layer's pixels are opaque.
- Selecting Blend Mode = Normal composites the shadow as a flat colored shape; Blend Mode = Multiply darkens the layers below rather than replacing them.
- Hiding the Drop Shadow adjustment layer removes the shadow from the canvas preview without affecting the parent layer.
- Deleting the Drop Shadow adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the Drop Shadow adjustment layer entirely.
- Clicking the Drop Shadow adjustment layer row reopens the panel showing all previously committed parameter values.
- Creating with an active selection restricts the shadow to that area; pixels outside the selection boundary produce no shadow.
- Entering X Offset = 300 clamps to 200; entering −300 clamps to −200. Spread = 150 clamps to 100. Opacity = 120 clamps to 100.
- A parent layer at 30% opacity produces a shadow that is visibly lighter than the same shadow on a layer at 100% opacity (the mask alpha is attenuated by the parent's opacity).
- The shadow is clipped at the canvas boundary — no shadow content appears outside the canvas edges.

## Edge Cases & Constraints

- When Spread = 0 and Softness = 0, the shadow is a hard, pixel-perfect copy of the source alpha mask, offset by X/Y. This is useful for a flat, stylized shadow.
- When X Offset = 0 and Y Offset = 0, the shadow is centered on the source content. With Spread > 0 or Softness > 0, this produces a halo/glow effect rather than a directional shadow. This is expected and supported behavior.
- Spread values are interpreted in pixels at the image's **full native resolution**. On small canvases, even small Spread values can noticeably alter the shadow shape.
- The shadow is derived from the **composited** content of the parent layer — meaning any existing adjustment layers applied below the Drop Shadow (e.g., Brightness/Contrast children of the same parent) are included in the source alpha computation.
- Multiple Drop Shadow adjustment layers may be stacked on the same parent layer, each with independent settings, allowing layered shadow effects.
- On a parent layer with uniform full opacity (all pixels fully opaque), the shadow will not be visible when Knockout is on, because the shadow is entirely occluded. The adjustment layer is still created and saved.
- Very large Softness values (approaching 100 px) on small-content layers may cause the shadow to visually dissolve (near-zero alpha everywhere), especially if Opacity is also low. This is expected behavior.
- The shadow color's alpha channel and the Opacity slider both attenuate the shadow. Setting the color to 50% alpha AND Opacity to 50% results in a shadow at 25% of its maximum visibility (multiplicative).
- The selection mask baked at creation time is static. Later selection changes do not update the shadow's scope.
- There is no keyboard shortcut assigned to this effect by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — architecture of the Effects/Adjustments menu system
- [bloom.md](bloom.md) — another real-time effect in the same Effects menu
- [color-key.md](color-key.md) — real-time effect that modifies layer alpha, which affects shadow generation
- [layer-groups.md](layer-groups.md) — layer nesting model that child adjustment layers follow
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — the compositing pipeline that must include Drop Shadow for flatten/merge/export
