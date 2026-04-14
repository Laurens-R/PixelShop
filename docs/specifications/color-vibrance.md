# Color Vibrance

## Overview

The **Color Vibrance** adjustment is a non-destructive child layer that provides two complementary saturation controls: **Vibrance** and **Saturation**. Vibrance intelligently boosts or reduces saturation in a way that preserves already-vivid colors while amplifying muted or undersaturated ones — a Lightroom-style approach that protects skin tones and fully-saturated hues. **Saturation** applies a uniform, linear boost or reduction across all pixels regardless of their current saturation level. Together the two controls give the user fine-grained management of color intensity. The adjustment is stored persistently, can be toggled or deleted at any time, and re-opened for editing whenever the user needs to revise its values.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Color Vibrance…** from the TopBar. If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Color Vibrance"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Color Vibrance"** opens, anchored to the upper-right corner of the canvas. It contains two controls, in order:
   - **Vibrance** — labeled slider (−100 to +100) with an adjacent numeric input. Default: 0.
   - **Saturation** — labeled slider (−100 to +100) with an adjacent numeric input. Default: 0.
5. Dragging either slider updates the canvas in real time. The user may type a value directly into either numeric input; values outside the allowed range are clamped on commit.
6. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, capturing the final state of both controls.
7. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The floating panel reopens at the previously saved Vibrance and Saturation values.
8. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.
- The panel **must** expose a **Vibrance** control: range −100 to +100, default 0.
- The Vibrance control **must** have a slider and a numeric input that remain in sync.
- The vibrance algorithm **must** apply saturation boost inversely proportional to a pixel's current saturation — pixels with low saturation receive a proportionally larger boost than pixels that are already highly saturated. This non-linear weighting is what distinguishes Vibrance from a uniform Saturation adjustment.
- The vibrance algorithm **must not** alter pixel luminance — only the saturation weighting is changed.
- The panel **must** expose a **Saturation** control below the Vibrance control: range −100 to +100, default 0.
- The Saturation control **must** have a slider and a numeric input that remain in sync.
- The Saturation algorithm **must** apply a uniform, linear saturation boost or reduction to every pixel regardless of its current saturation level.
- The Saturation algorithm **must not** alter pixel luminance — only the saturation channel is changed.
- Both controls **must** be composited together; the combined effect of Vibrance and Saturation is applied as a single pass at render time.
- The canvas **must** update in real time as either slider is dragged.
- Closing the panel **must** record exactly one undo history entry covering the final values of both controls. Undoing **must** remove the adjustment layer.
- The adjustment layer **must** support visibility toggle, deletion, and re-editing from the Layer Panel.

## Acceptance Criteria

- After creating the adjustment, the parent layer's pixel data is unchanged.
- Setting Vibrance to +100 on a layer with a mix of muted and vivid colors causes a noticeably larger saturation increase in the muted areas than in the vivid areas.
- Setting Vibrance to −100 on a layer with a mix causes a noticeably larger saturation decrease in the muted areas than in the vivid areas.
- Fully neutral (achromatic, R = G = B) pixels are unaffected at any Vibrance value because they have zero saturation to modify.
- Setting Saturation to +100 causes a uniform increase in saturation across all non-achromatic pixels.
- Setting Saturation to −100 causes a uniform decrease in saturation across all non-achromatic pixels, trending toward grayscale.
- With Vibrance at 0 and Saturation at 0 the canvas appearance is identical to the unmodified parent layer.
- The canvas preview updates continuously during drag of either slider.
- Typing a value of 150 into either numeric input is clamped to 100; typing −150 is clamped to −100.
- Creating with an active selection restricts the visible effect to that area.
- Creating with no active selection applies the effect to the full layer.
- Pixel luminance values are unchanged by any combination of Vibrance and Saturation settings (brightness is unaffected).
- Hiding the adjustment layer removes the visual effect without deleting it.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel at the previously saved Vibrance and Saturation values.

## Edge Cases & Constraints

- Fully transparent pixels (alpha = 0) remain fully transparent regardless of Vibrance value.
- Achromatic pixels (R = G = B) are not affected by any Vibrance value because they have no saturation component.
- Vibrance does not clamp already-saturated colors to 100% saturation when boosted at moderate values; the non-linear weighting naturally limits the effect on vivid pixels.
- Multiple Color Vibrance adjustments may be stacked on the same parent layer; each is independent.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [brightness-contrast.md](brightness-contrast.md) — complementary luminance adjustment
- [hue-saturation.md](hue-saturation.md) — complementary hue and uniform-saturation adjustment
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
