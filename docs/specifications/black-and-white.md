# Black and White

## Overview

The **Black and White** adjustment is a non-destructive child layer that converts the parent pixel layer to grayscale by allowing the user to control how much each color range — Reds, Yellows, Greens, Cyans, Blues, and Magentas — contributes to the resulting brightness. Rather than using a fixed luminosity formula, the user can make specific hues appear lighter or darker in the gray output, enabling precise tonal control for photography and illustration. The result is always fully desaturated regardless of slider positions. The adjustment is stored persistently, can be toggled or deleted at any time, and re-opened for editing whenever the user needs to revise its values.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Black and White…** from the TopBar. If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Black and White"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Black and White"** opens, anchored to the upper-right corner of the canvas. It contains six labeled sliders, each with an adjacent numeric input, listed in order:
   - **Reds** — range −200 to +300, default 40.
   - **Yellows** — range −200 to +300, default 60.
   - **Greens** — range −200 to +300, default 40.
   - **Cyans** — range −200 to +300, default 60.
   - **Blues** — range −200 to +300, default 20.
   - **Magentas** — range −200 to +300, default 80.
5. The canvas immediately shows a grayscale preview of the parent layer using the default weights. Dragging any slider updates the canvas in real time: increasing a slider's value causes pixels whose color falls within that hue range to appear brighter in the grayscale output; decreasing it causes them to appear darker.
6. The user may type a value directly into any numeric input; values outside the allowed range are clamped on commit.
7. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, capturing the final state of all six sliders.
8. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The floating panel reopens at the previously saved values.
9. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The panel **must** expose six controls, each with a slider and a synchronized numeric input, one per color range:
  - **Reds**, **Yellows**, **Greens**, **Cyans**, **Blues**, **Magentas**.
  - Range for each: −200 to +300.
  - Defaults: Reds 40, Yellows 60, Greens 40, Cyans 60, Blues 20, Magentas 80.
- Each slider value **must** represent the brightness weight assigned to pixels whose dominant hue falls within that color range. Higher values cause those pixels to appear brighter; lower values cause them to appear darker, including below zero (clamped to black in the output).
- The contribution of each slider to a given pixel **must** be proportional to how closely that pixel's hue matches the named color range, using a smooth hue-band weighting so that pixels near hue boundary regions blend contributions from adjacent sliders.
- The output **must** always be fully grayscale (R = G = B) for every pixel regardless of slider values. No combination of slider positions produces a colored output.
- Output brightness values **must** be clamped to the range [0, 255]; no slider combination can push a pixel below black or above white.
- The canvas **must** update in real time as any slider is dragged.
- Closing the panel **must** record exactly one undo history entry covering the final state of all six controls. Undoing **must** remove the adjustment layer.
- The adjustment layer **must** support visibility toggle, deletion, and re-editing from the Layer Panel.

## Acceptance Criteria

- Immediately upon opening the panel (before any slider change) the canvas shows a grayscale rendering of the parent layer.
- Increasing the Reds slider from its default causes red-hued areas of the layer to appear brighter in the output.
- Decreasing the Blues slider to −200 causes blue-hued areas to appear black in the output.
- At any slider combination, all output pixels are grayscale (R = G = B).
- Pixels at the boundary of two hue ranges (e.g., an orange pixel between Reds and Yellows) smoothly blend the contribution of both adjacent sliders.
- Setting all sliders to the same value produces a flat-luminance grayscale result (equivalent to a simple desaturation at that weight).
- Typing a value of 400 into a numeric input is clamped to 300; typing −300 is clamped to −200.
- Creating the adjustment while a selection is active restricts the visible effect to that area; pixels outside it are unaffected.
- Creating the adjustment with no active selection applies the effect to the full layer.
- Fully transparent pixels remain fully transparent regardless of slider values.
- Hiding the adjustment layer removes the visual effect without deleting the layer, restoring the original color appearance.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel at the previously saved six slider values.

## Edge Cases & Constraints

- Achromatic pixels (R = G = B) have no dominant hue and therefore are not strongly weighted by any single slider; their brightness in the output is determined by an equal blend across all sliders.
- Fully transparent pixels (alpha = 0) remain fully transparent regardless of slider values.
- The adjustment does not add color toning (sepia, duotone, etc.); it is strictly a conversion to neutral gray.
- Multiple Black and White adjustments may be stacked on the same parent layer; each is independent.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.
- There is no keyboard shortcut assigned to this adjustment by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [hue-saturation.md](hue-saturation.md) — Hue/Saturation at Saturation −100 also produces grayscale, but with a fixed luminosity formula and no per-channel control
- [brightness-contrast.md](brightness-contrast.md) — typically applied after Black and White to adjust the grayscale tonal range
- [selective-color.md](selective-color.md) — shares a per-hue-range selection model for per-channel control
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
