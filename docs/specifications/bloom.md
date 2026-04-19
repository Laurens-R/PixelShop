# Bloom

## Overview

**Bloom** is a non-destructive adjustment layer that adds a soft, glowing halo to the bright areas of the image below it. It mimics the optical phenomenon where intense light sources bleed beyond their physical boundaries — a characteristic of camera lenses, film stock, and human vision under high-contrast conditions. Because it is an adjustment layer, the effect is live and fully reversible: the user can tune its parameters at any time without touching the underlying pixel data. Bloom is categorized as a **Real-time Effect**, a distinct class of adjustments that synthesize new visual content from image luminance rather than applying a tonal or color correction.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens the **Image** menu and scrolls to the **Real-time Effects** section, separated from the standard color/tonal adjustments by a labeled divider.
3. The user clicks **Bloom…**. A new child adjustment layer named **"Bloom"** appears in the Layer Panel, nested immediately beneath the active pixel layer, and the **Bloom** panel opens anchored to the upper-right corner of the canvas.
4. The panel presents four controls:
   - **Threshold** — labeled slider (0.00–1.00, default 0.50). Sets the luminance level above which pixels begin contributing to the glow. The contribution ramps in gradually (soft knee) rather than switching on at a hard cutoff.
   - **Strength** — labeled slider (0.00–2.00, default 0.50). Controls how intensely the glow map is mixed back over the source. At 0.00 the effect is invisible. At 2.00 the glow is at double intensity.
   - **Spread** — labeled slider (1–100, default 20, unit "px"). Controls the physical radius of the halo at full canvas resolution. Larger values produce a wider, more diffuse glow.
   - **Quality** — three-option control (radio group or select): **Full**, **Half** (default), **Quarter**. Sets the resolution at which the internal glow map is computed before it is upscaled back to canvas size. Lower quality produces a softer, faster result; Full quality renders the glow map at native canvas resolution.
5. Adjusting any control updates the canvas preview in real time.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, regardless of how many control adjustments were made.
7. To revise the effect later, the user clicks the **"Bloom"** adjustment layer row in the Layer Panel. The panel reopens at the previously saved values.
8. The adjustment layer can be hidden (eye icon) to temporarily disable the bloom effect, or deleted (trash icon / Delete key when the layer is selected) to remove it permanently.

## Functional Requirements

- The **Bloom…** menu item **must** appear in the **Image** menu under a **Real-time Effects** section, visually separated from standard tonal and color adjustments by a labeled divider. It **must** be disabled when the active layer is not a pixel layer (or no layer is active).
- Clicking the enabled menu item **must** create a new child adjustment layer parented to the active pixel layer and immediately open the Bloom panel. The parent pixel layer's pixel data **must not** be modified.
- The panel **must** expose the following controls, all kept in sync with the live canvas preview:
  - **Threshold**: range 0.00–1.00, default 0.50. Displayed as a labeled slider with a numeric input.
  - **Strength**: range 0.00–2.00, default 0.50. Displayed as a labeled slider with a numeric input.
  - **Spread**: integer range 1–100, default 20. Displayed as a labeled slider with a numeric input. The unit label "px" is shown adjacent to the input. The value is interpreted as pixels at the image's full native resolution.
  - **Quality**: three mutually exclusive options — **Full**, **Half**, **Quarter** — displayed as a radio group or single-select control. Default is **Half**.
- Values entered outside the allowed range **must** be clamped: Threshold below 0 is set to 0, above 1 is set to 1; Strength below 0 is set to 0, above 2 is set to 2; Spread below 1 is set to 1, above 100 is set to 100.
- The glow must be computed as follows:
  1. Extract pixels from the layer(s) below the adjustment within the same compositing stack.
  2. For each pixel, compute a contribution weight using a **soft-knee curve** centered on the Threshold value — pixels well below the threshold contribute near zero; pixels well above it contribute near their full luminance; pixels near the threshold ramp smoothly between the two extremes.
  3. Apply the contribution weight to produce a luminance-masked version of the source pixels. The original hue and saturation of each pixel are **preserved** — a bright red area produces a red glow, not a white one.
  4. Optionally downsample this glow mask to the resolution indicated by Quality (Half = 50 % linear, Quarter = 25 % linear).
  5. Apply a fast multi-pass box blur with a radius derived from the Spread value.
  6. Upsample back to full canvas resolution.
  7. Composite the glow map over the source using **Screen blend mode** (result = 1 − (1 − source) × (1 − glow)). The Strength parameter scales the glow map before screening, so at Strength = 0 the glow map is zeroed and at Strength = 2 it is doubled before the Screen composite.
- The canvas preview **must** update in real time while any control is being adjusted.
- Closing the panel **must** record exactly one undo history entry. Pressing Ctrl+Z / Cmd+Z once **must** remove the adjustment layer and restore the canvas to its pre-bloom appearance.
- The adjustment layer **must** support:
  - **Visibility toggle** — hiding suppresses the bloom effect without deleting the layer or its settings.
  - **Deletion** — permanently removes the layer and restores the underlying appearance.
  - **Re-editing** — clicking the layer row in the Layer Panel reopens the panel with the last committed values.
  - **Selection mask** — if a selection is active when the adjustment layer is created, the bloom effect is restricted to that selected area; the mask is baked into the adjustment layer at creation time.

## Acceptance Criteria

- With a pixel layer active, **Image → \[Real-time Effects\] → Bloom…** is enabled and opens the Bloom panel while creating a child adjustment layer in the Layer Panel.
- With a non-pixel layer active (or no layer), the Bloom menu item is grayed out and produces no action.
- The adjustment layer appears nested under the parent pixel layer in the Layer Panel, consistent with other adjustment layers.
- The parent pixel layer's pixel data is unchanged after creating the Bloom adjustment (verifiable by reading raw pixel values).
- Setting Strength to 0.00 produces no visible difference from the unmodified source.
- Setting Threshold to 1.00 causes no pixels to contribute to the glow (glow map is black), making the effect invisible regardless of Strength.
- Setting Threshold to 0.00 causes all pixels to contribute to the glow map.
- Reducing Spread to 1 produces a tight, narrow halo; increasing it to 100 produces a broad, diffuse halo.
- The glow color visually matches the hue of the source bright areas (a red-lit area produces a reddish glow, not a gray or white one).
- The Screen composite mode ensures the result is never darker than the source and never fully blows out to pure white except where Strength pushes the glow map to maximum.
- Switching Quality from **Full** to **Quarter** produces a visibly softer glow (slight resolution degradation in the halo) and no other change to the effect character.
- The canvas preview responds to slider movement without perceptible lag for typical image sizes.
- Hiding the Bloom adjustment layer removes the bloom effect from the canvas preview without deleting the layer.
- Deleting the Bloom adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified appearance.
- Pressing Ctrl+Z / Cmd+Z once after closing the panel removes the Bloom adjustment layer entirely.
- Clicking the Bloom adjustment layer row in the Layer Panel reopens the panel showing the previously committed Threshold, Strength, Spread, and Quality values.
- If a selection was active at creation time, the bloom effect is visible only inside the original selection boundary.
- Entering Threshold = 1.5 clamps to 1.00; Threshold = −0.1 clamps to 0.00. Strength = 3.0 clamps to 2.00. Spread = 0 clamps to 1; Spread = 200 clamps to 100.

## Edge Cases & Constraints

- Bloom is composited using Screen, which is commutative and cannot produce a result darker than either input. This means the effect can never darken pixels, only lighten them.
- At Strength = 2.00 combined with a low Threshold, large areas of the image may approach near-white due to the doubled glow map. This is expected, intentional behavior.
- The Spread value is defined in pixels at the image's **full native resolution**. On a small canvas (e.g. 64 × 64), a Spread of 20 is a large fraction of the image; on a 4000 × 4000 canvas it produces a more modest halo. Users should adjust Spread relative to their canvas size.
- The soft-knee behavior around the Threshold means there is no sharp edge or visible banding in the glow falloff regardless of the Threshold value chosen.
- The Bloom adjustment layer does not apply to layers above it in the stack — only to the composited result of layers below it within the same group.
- If the parent pixel layer has zero visible content (fully transparent or all-black pixels), the bloom effect produces no glow. The layer is still created and records an undo entry.
- Multiple Bloom adjustments may be stacked on the same parent pixel layer. Each is independent and additive in effect.
- The selection mask baked at creation time is static. If the user modifies the selection after the Bloom layer is created, the mask does not update.
- Bloom is not applicable to text layers, shape layers, mask layers, or adjustment layers.
- There is no keyboard shortcut assigned to this adjustment by default.

## Out of Scope

- **Anamorphic or directional bloom** — streak artifacts along a specific axis are not part of this feature (see [lens-flare-streak-controls.md](lens-flare-streak-controls.md)).
- **Per-channel threshold** — applying different threshold values to the R, G, and B channels independently is not supported.
- **Animatable parameters** — keyframing any bloom parameter over time is not supported.
- **Hard-knee threshold mode** — the threshold is always a soft-knee curve; a hard binary cutoff is not offered.
- **Custom glow color** — the glow always inherits the hue of the source pixels; tinting the glow to an independent color is not supported.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the Image menu structure and the new Real-time Effects separator that hosts Bloom
- [lens-flare.md](lens-flare.md) — a related optical render effect; anamorphic streak behavior lives in [lens-flare-streak-controls.md](lens-flare-streak-controls.md)
- [gaussian-blur.md](gaussian-blur.md) — the blur technique (multi-pass box blur) on which the Spread step is based
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — the compositing pipeline responsible for applying this adjustment during flatten, merge, and export
