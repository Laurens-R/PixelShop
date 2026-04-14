# Selective Color

## Overview

The **Selective Color** adjustment is a non-destructive child layer that lets the user adjust the CMYK channel composition (Cyan, Magenta, Yellow, Black) of individual color ranges within a parent pixel layer — without affecting other color ranges. Nine color ranges are available: Reds, Yellows, Greens, Cyans, Blues, Magentas, Whites, Neutrals, and Blacks. A mode toggle switches between **Relative** (proportional) and **Absolute** (additive) adjustment methods. This gives the user precise, targeted color correction that is particularly useful for adjusting specific object colors without affecting the rest of the image. The adjustment is stored persistently, can be toggled or deleted at any time, and re-opened for editing whenever the user needs to revise its values.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Selective Color…** from the TopBar. If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Selective Color"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Selective Color"** opens, anchored to the upper-right corner of the canvas. It contains:
   - **Color range selector** — a dropdown listing the nine ranges: Reds, Yellows, Greens, Cyans, Blues, Magentas, Whites, Neutrals, Blacks. **Reds** is selected by default.
   - Four labeled sliders for the currently selected color range, each with an adjacent numeric input:
     - **Cyan** — range −100 to +100, default 0.
     - **Magenta** — range −100 to +100, default 0.
     - **Yellow** — range −100 to +100, default 0.
     - **Black** — range −100 to +100, default 0.
   - **Method** toggle with two options: **Relative** (default) and **Absolute**.
5. The user selects a color range from the dropdown to configure it. The four sliders update to reflect that range's current values. Each color range stores its four slider values independently.
6. Dragging any slider updates the canvas in real time. Only pixels whose color falls within the currently active range (and adjacent ranges, blended by proximity) are affected by the change. The user may also type a value into any numeric input; values outside the allowed range are clamped on commit.
7. The user changes the Method toggle between Relative and Absolute at any time; this affects how all ranges' slider values are interpreted at render time and immediately updates the canvas preview.
8. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, capturing all nine ranges' slider values and the Method setting.
9. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The floating panel reopens with the previously saved values; Reds is selected by default in the dropdown.
10. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The panel **must** expose a **color range selector** (dropdown) with the following nine options: Reds, Yellows, Greens, Cyans, Blues, Magentas, Whites, Neutrals, Blacks. **Reds** **must** be selected by default.
- For each color range the panel **must** maintain four independent slider values: **Cyan**, **Magenta**, **Yellow**, and **Black**, each ranging from −100 to +100 with a default of 0.
- Each range's four values **must** be stored independently; modifying the Reds range **must not** affect the stored values for any other range.
- The degree to which a pixel participates in a given color range's adjustments **must** be determined by how closely that pixel's color matches the named range. Pixels near the boundary of two ranges blend contributions from both.
  - Reds, Yellows, Greens, Cyans, Blues, and Magentas **must** be keyed to hue angle.
  - Whites **must** be keyed to high lightness/brightness.
  - Blacks **must** be keyed to low lightness/brightness.
  - Neutrals **must** be keyed to low saturation (achromatic and near-achromatic pixels).
- The panel **must** expose a **Method** toggle: **Relative** and **Absolute**.
  - **Relative** mode: each slider adjusts a channel value by a percentage of that channel's existing amount. A pixel with zero of a given channel is unaffected by that channel's slider in Relative mode.
  - **Absolute** mode: each slider adds or subtracts a fixed amount (scaled from the −100 to +100 range) to the channel, regardless of the pixel's existing channel value.
- The canvas **must** update in real time as any slider is dragged or the Method toggle is changed.
- Closing the panel **must** record exactly one undo history entry covering all nine ranges and the Method setting. Undoing **must** remove the adjustment layer.
- The adjustment layer **must** support visibility toggle, deletion, and re-editing from the Layer Panel.

## Acceptance Criteria

- With all sliders at 0 the canvas appearance is identical to the unmodified parent layer, regardless of the Method setting.
- Dragging the Reds → Cyan slider to +100 in Relative mode adds cyan to red-hued areas of the layer and has no visible effect on blue or green areas.
- Dragging the Blacks → Black slider to +100 darkens the darkest areas of the layer and has no visible effect on bright or highly saturated areas.
- Switching between Relative and Absolute with non-zero sliders produces a visibly different result on the canvas.
- In Relative mode, a pixel that contains zero of the target channel (e.g., no existing Cyan component) is not affected by that range's Cyan slider.
- In Absolute mode, a pixel with no existing Cyan component is still affected by the Cyan slider.
- Each color range retains its independently-set slider values when the user changes the dropdown selection.
- Typing a value of 150 into any numeric input is clamped to 100; typing −150 is clamped to −100.
- Creating the adjustment while a selection is active restricts the visible effect to that area; pixels outside it are unaffected.
- Creating the adjustment with no active selection applies the effect to the full layer.
- Fully transparent pixels remain fully transparent regardless of slider values.
- Hiding the adjustment layer removes the visual effect without deleting the layer.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel at the previously saved values.

## Edge Cases & Constraints

- Fully transparent pixels (alpha = 0) remain fully transparent regardless of slider values.
- In Relative mode, achromatic (neutral gray) pixels will not be visibly affected by hue-based range sliders (Reds through Magentas) because those pixels have no color channel dominance; the Neutrals range sliders are the intended path for adjusting neutral tones.
- Channel values are clamped to [0, 255] after the adjustment is applied; no combination of slider values can produce out-of-range output.
- All nine ranges are evaluated and their contributions blended per pixel at render time; performance for large layers may be slower than single-range adjustments.
- Multiple Selective Color adjustments may be stacked on the same parent layer; each is independent.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.
- There is no keyboard shortcut assigned to this adjustment by default.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [black-and-white.md](black-and-white.md) — shares the per-hue-range selection model
- [color-balance.md](color-balance.md) — complementary tonal-range color grading
- [hue-saturation.md](hue-saturation.md) — complementary global hue and saturation control
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
