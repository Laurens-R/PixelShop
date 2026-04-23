# Glow

## Overview

**Glow** is a non-destructive adjustment layer that radiates a soft, colored halo outward from the visible content of its parent layer. Only pixels with non-zero alpha emit glow — fully transparent pixels contribute nothing. Unlike Drop Shadow, the glow is always centered on the source content; there is no offset. The glow is composited relative to the parent layer's pixels and, when Knockout is enabled (the default), is only visible outside and around the source content, creating a classic outer-glow appearance. When Knockout is disabled, the glow is also visible beneath the source's own pixels. Because it is an adjustment layer, the effect is fully reversible and re-editable at any time without modifying the underlying pixel data. Glow is categorized as a **Real-time Effect** and appears in the **Effects** menu, alongside Bloom, Drop Shadow, Chromatic Aberration, Halation, and Color Key.

## User Interaction

1. The user selects a pixel layer, text layer, or shape layer in the Layer Panel.
2. The user opens the **Effects** menu in the top menu bar and clicks **Glow…**. The item is disabled when no eligible layer is active.
3. A new child adjustment layer named **"Glow"** appears in the Layer Panel, indented immediately beneath the active layer. The **Glow** panel opens, anchored to the upper-right corner of the canvas.
4. The panel exposes the following controls:
   - **Color** — an RGBA color swatch (default: light yellow, `#FFFF99FF`). Clicking it opens a color picker with an alpha channel. The color defines the hue and base transparency of the glow.
   - **Opacity** — labeled slider and numeric input (0–100%, default 75%). Scales the glow's overall transparency on top of the color's own alpha. This is the primary opacity control.
   - **Spread** — labeled slider and numeric input (0–100 px, default 0). Expands the glow's alpha silhouette outward before blurring, widening the glow boundary. At 0 the glow's initial shape matches the source silhouette exactly.
   - **Softness** — labeled slider and numeric input (0–100 px, default 15). The Gaussian blur radius applied to the spread glow mask. At 0 the glow edges are hard; higher values produce a progressively softer, more diffuse halo.
   - **Blend Mode** — a dropdown (default: Normal). Controls how the glow composites with the layers below it. Common options include Normal, Screen, and Multiply.
   - **Knockout** — a checkbox (default: on). When enabled, the source layer's own opaque pixels occlude the glow beneath them, so the glow is only visible around and outside the source content (outer glow). When disabled, the glow is also visible beneath the source layer's own pixels.
5. Adjusting any control updates the canvas preview in real time.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, regardless of how many controls were adjusted during the session.
7. To revise the effect later, the user clicks the **"Glow"** adjustment layer row in the Layer Panel. The panel reopens at the previously committed values.
8. The adjustment layer can be hidden (eye icon) to temporarily suppress the glow without deleting settings, or deleted to remove the effect permanently.

## Functional Requirements

- The **Glow…** menu item **must** appear in the **Effects** top-level menu.
- The item **must** be enabled only when the active layer is a pixel layer, text layer, or shape layer. It **must** be disabled when the active layer is a mask layer, another adjustment layer, a layer group, or when no layer is active.
- Activating the menu item **must** create a new child adjustment layer parented to the active layer and immediately open the Glow panel. The parent layer's pixel data **must not** be modified.
- The adjustment layer **must** be stored non-destructively: parameters are saved on the layer record and applied at render time.
- The Glow parameter set **must not** include X Offset or Y Offset. The glow is always centered on the source content; offset is implicitly (0, 0) and is not user-configurable.
- The panel **must** expose the following controls, each with a slider (where applicable) and a numeric input that remain in sync:
  - **Color**: RGBA color picker. Default `#FFFF99FF` (light yellow, fully opaque). Any valid RGBA value is accepted.
  - **Opacity**: range 0–100%, default 75%. Values outside the range are clamped.
  - **Spread**: range 0–100 px, default 0. Values below 0 are clamped to 0; values above 100 are clamped to 100.
  - **Softness**: range 0–100 px, default 15. Same clamping rule as Spread.
  - **Blend Mode**: dropdown selector. Default Normal. Must include at least: Normal, Screen, Multiply.
  - **Knockout**: checkbox. Default enabled (checked).
- The glow **must** be computed using the following pipeline:
  1. **Extract alpha** — read the alpha channel of the composited parent layer content to produce a greyscale silhouette mask (pixel alpha 0–255).
  2. **Expand by Spread** — grow the silhouette outward by the Spread value using morphological dilation (or equivalent), producing a wider glow boundary. When Spread = 0 this step is a no-op.
  3. **Gaussian blur** — apply a Gaussian blur with radius equal to the Softness value to the expanded mask, softening its edges. When Softness = 0 this step is a no-op.
  4. **Colorize** — multiply the blurred mask by the selected glow color. The final per-pixel glow alpha = `mask_alpha × color.alpha × (opacity / 100)`.
  5. **No offset step** — the glow is always centered on the source content. No translation is applied.
  6. **Composite under source** — render the glow layer below the parent layer's pixels in the compositing order, using the selected Blend Mode. When Knockout is enabled, the glow is additionally masked by the inverse of the parent layer's own alpha so that the source content fully occludes the glow beneath it (outer glow only). When Knockout is disabled, the glow is visible through the parent layer's transparent regions and may also be partially visible under semi-transparent pixels depending on their alpha.
- The canvas preview **must** update in real time while any control is being adjusted, without perceptible lag on typical image sizes.
- Closing the panel **must** record exactly one undo history entry. Pressing Ctrl+Z / Cmd+Z once **must** remove the Glow adjustment layer and restore the canvas to its pre-glow state.
- The adjustment layer **must** support:
  - **Visibility toggle** — hiding the layer suppresses the glow without deleting it or its settings.
  - **Deletion** — permanently removes the adjustment layer and restores the underlying appearance.
  - **Re-editing** — clicking the layer row in the Layer Panel reopens the panel with the last committed parameter values.
- The adjustment layer's visibility and rendering **must** honor the parent layer's own state:
  - If the parent layer's **visibility** is off, the glow **must not** be rendered (no glow without visible source content).
  - The parent layer's **opacity** scales the effective alpha of the source content used to derive the glow mask. A parent layer at 50% opacity produces a glow whose mask alpha is at most 50%, multiplied further by the glow's own Opacity parameter.
  - The glow's Opacity parameter is independent of the parent's opacity and applies on top of it.
- The glow **must** be clipped to the canvas boundary. No part of the glow extends or bleeds outside the canvas edges.
- If a selection is active when the Glow adjustment layer is created, the glow **must** be restricted to the selected area; the selection mask is baked into the adjustment layer at creation time and does not update if the selection changes later.

## Acceptance Criteria

- With a pixel, text, or shape layer active, **Effects → Glow…** is enabled and creates a child adjustment layer named "Glow" + opens the panel.
- With a mask layer, adjustment layer, layer group, or no active layer, the menu item is grayed out and produces no action.
- The Glow panel contains no X Offset or Y Offset control.
- The panel opens with Color = `#FFFF99FF`, Opacity = 75%, Spread = 0, Softness = 15, Blend Mode = Normal, Knockout = checked.
- The parent layer's raw pixel data is unchanged after creating the Glow adjustment (verifiable by reading raw pixel values before and after).
- With default parameters on a pixel layer containing opaque content, a soft light-yellow halo is visible around and outside the source silhouette, with no glow visible beneath the source's own opaque pixels (Knockout on).
- Fully transparent pixels in the source layer produce no glow.
- Setting Opacity to 0% produces no visible glow, regardless of color, spread, or softness.
- With Knockout on, the glow is occluded wherever the source layer's pixels are opaque; the effect is visible only around the exterior of the source content.
- With Knockout off, the glow is visible beneath the source content's own pixels (glow bleeds through semi-transparent and opaque areas of the source).
- Setting Spread = 0 and Softness = 0 produces a hard glow exactly aligned with the source silhouette, fully hidden behind opaque source pixels when Knockout is on.
- Increasing Softness from 0 to 50 progressively softens the glow edge from a hard boundary to a diffuse feathered halo.
- Increasing Spread from 0 to 50 visibly widens the glow silhouette beyond the source content boundary, even before blurring.
- Selecting Blend Mode = Normal composites the glow as a flat colored shape; Blend Mode = Screen lightens the layers below rather than replacing them.
- Changing the Color to opaque red (`#FF0000FF`) produces a red halo around the source content.
- Hiding the Glow adjustment layer removes the glow from the canvas preview without affecting the parent layer.
- Deleting the Glow adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the Glow adjustment layer entirely.
- Clicking the Glow adjustment layer row reopens the panel showing all previously committed parameter values.
- Creating with an active selection restricts the glow to that area; pixels outside the selection boundary produce no glow.
- Entering Spread = 150 clamps to 100; Softness = −5 clamps to 0; Opacity = 120 clamps to 100.
- A parent layer at 30% opacity produces a glow that is visibly lighter than the same glow on a layer at 100% opacity (the mask alpha is attenuated by the parent's opacity).
- The glow is clipped at the canvas boundary — no glow content appears outside the canvas edges.
- The glow remains centered on the source content at all times; there is no visible offset between the source silhouette and the center of the resulting halo.

## Edge Cases & Constraints

- When Spread = 0 and Softness = 0, the glow is a hard, pixel-perfect ring aligned with the source alpha mask (visible only outside the source when Knockout is on). This produces a sharp outline effect rather than a soft halo.
- Unlike Drop Shadow, there is no X/Y offset concept. The glow always radiates symmetrically from the source content in all directions. Directional shadow effects require a separate Drop Shadow adjustment layer.
- Spread values are interpreted in pixels at the image's **full native resolution**. On small canvases, even small Spread values can noticeably alter the glow shape.
- The glow is derived from the **composited** content of the parent layer — meaning any existing adjustment layers applied below the Glow layer (e.g., Brightness/Contrast children of the same parent) are included in the source alpha computation.
- Multiple Glow adjustment layers may be stacked on the same parent layer, each with independent settings, allowing layered or multi-colored halo effects.
- On a parent layer with uniform full opacity (all pixels fully opaque), the glow will not be visible when Knockout is on, because the glow is entirely occluded by the source. The adjustment layer is still created and saves its undo entry.
- Very large Softness values (approaching 100 px) on small-content layers may cause the glow to visually dissolve (near-zero alpha everywhere), especially if Opacity is also low. This is expected behavior.
- The glow color's alpha channel and the Opacity slider both attenuate the glow. Setting the color to 50% alpha AND Opacity to 50% results in a glow at 25% of its maximum visibility (multiplicative).
- The selection mask baked at creation time is static. Later selection changes do not update the glow's scope.
- There is no keyboard shortcut assigned to this effect by default.
- Glow and Drop Shadow may coexist on the same parent layer as independent adjustment layers. They composite independently and do not interfere with each other.

## Related Features

- [drop-shadow.md](drop-shadow.md) — the closely related real-time effect from which Glow inherits its pipeline; the key distinction is that Glow has no X/Y offset, uses a warm-light default color, defaults to Normal blend mode, and defaults Knockout to on
- [bloom.md](bloom.md) — another real-time glow effect in the Effects menu; Bloom derives its halo from image luminance rather than layer alpha, making it image-reactive rather than silhouette-reactive
- [adjustment-menu.md](adjustment-menu.md) — architecture of the Effects/Adjustments menu system that hosts Glow
- [color-key.md](color-key.md) — real-time effect that modifies layer alpha, which affects glow generation
- [layer-groups.md](layer-groups.md) — layer nesting model that child adjustment layers follow
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — the compositing pipeline that must include Glow for flatten/merge/export
