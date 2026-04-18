# Color Grading

## Overview

The **Color Grading** adjustment is a non-destructive child layer that provides professional primary color correction modelled after the DaVinci Resolve Color Wheels workflow. It exposes four tonal-range color wheels (Lift, Gamma, Gain, Offset) alongside a full set of global and secondary controls — covering color temperature, contrast, saturation, and luminosity blending — to give users comprehensive stylistic and corrective control over a layer's color in a single, unified panel. The adjustment is stored persistently, can be toggled or deleted at any time, and re-opened for editing whenever the user needs to revise its values.

## User Interaction

1. The user selects a pixel layer in the Layer Panel.
2. The user opens **Image → Color Grading…** from the TopBar. If a selection is currently active it will scope the adjustment; if none exists the whole layer is targeted.
3. A new child layer named **"Color Grading"** appears in the Layer Panel, indented directly beneath the parent layer — the same visual treatment as a layer mask.
4. A floating panel titled **"Color Grading"** opens, anchored to the upper-right corner of the canvas. The panel is organized into three visual rows:

   **Color Wheels row** — four wheels displayed side by side, labelled **Lift**, **Gamma**, **Gain**, and **Offset** (left to right). Each wheel consists of:
   - A **circular color disk**: a filled disk visualizing hue around the circumference and saturation radially (fully saturated at the rim, neutral at the center). A draggable **puck** marks the current hue+chroma selection. Clicking or dragging anywhere inside the disk moves the puck to that position.
   - An **outer luma ring**: an arc control surrounding the disk that represents the master brightness for that tonal range. Dragging clockwise along the ring increases the master value; dragging counter-clockwise decreases it. Up/down drag anywhere on the ring arc also adjusts the value.
   - **Four numeric fields** below the disk, labelled **M** (master/white), **R**, **G**, **B**, showing the current numeric values for each channel and the luma ring. The user may click a field and type a value directly, or scroll the pointer over a field to increment/decrement it.
   - A **reset button** (↺) adjacent to the wheel label that returns that wheel's puck to center and its luma ring to the neutral position, clearing all channel offsets for that tonal range.

   **Top row (global controls)** — a horizontal strip of five labeled sliders with adjacent numeric inputs:
   - **Temp** — color temperature shift (cool ↔ warm). Range: −100 to +100, default 0.
   - **Tint** — green/magenta tint. Range: −100 to +100, default 0.
   - **Contrast** — overall contrast multiplier. Range: 0 to 2, default 1.0.
   - **Pivot** — the luminance level held fixed during contrast scaling. Range: 0 to 1, default 0.435.
   - **Mid/Detail** — midtone clarity / local contrast. Range: −100 to +100, default 0.

   **Bottom row (secondary controls)** — a horizontal strip of six labeled sliders with adjacent numeric inputs:
   - **Color Boost** — vibrance-style selective saturation boost that preferentially lifts less-saturated areas. Range: 0 to 100, default 0.
   - **Shadows** — shadow lift/crush independent of the Lift wheel. Range: −100 to +100, default 0.
   - **Highlights** — highlight roll-off independent of the Gain wheel. Range: −100 to +100, default 0.
   - **Saturation** — global HSL saturation. Range: 0 to 100, default 50 (50 = no change; values above 50 increase saturation, values below 50 decrease it).
   - **Hue** — global hue rotation. Range: 0 to 100, default 50 (50 = no rotation; values away from 50 rotate in either direction).
   - **Lum Mix** — blends the full color-corrected result (0) with a luminosity-preserving version of it (100), controlling how much of the correction is allowed to shift perceived brightness. Range: 0 to 100, default 100.

5. Any interaction with the color wheels or sliders updates the canvas in real time.
6. Double-clicking the puck on any wheel resets that wheel's color (hue+chroma) to neutral without affecting its luma ring. Double-clicking a numeric field resets that individual parameter to its default value.
7. The user closes the panel by clicking outside it or pressing Escape. One undo history entry is recorded at this moment, capturing the final state of all parameters.
8. To revise the adjustment later, the user clicks the adjustment layer's row in the Layer Panel. The panel reopens with all previously saved values restored.
9. The adjustment layer can be hidden (eye icon) to temporarily disable it, or deleted to remove it permanently.

## Functional Requirements

- The adjustment **must** be stored as a non-destructive child adjustment layer immediately following its parent in the layer stack, with a `parentId` reference to the parent pixel layer.
- The parent pixel layer's pixel data **must not** be modified by this adjustment.
- The adjustment **must** be composited on top of the parent layer's pixels at render time using the saved parameters.
- If a selection is active when the adjustment is created, only pixels within the selection boundary **must** be affected; the selection mask is baked into the adjustment layer at creation time.
- If no selection is active, the adjustment **must** affect the entire parent layer.

### Color Wheels

- The panel **must** expose four color wheels: **Lift** (shadows), **Gamma** (midtones), **Gain** (highlights), and **Offset** (global tonal offset applied uniformly across all luminance levels).
- Each wheel **must** have a circular color disk where the angular position of the puck encodes hue and the radial distance from center encodes chroma. Puck position (0, 0) — center — represents no color shift.
- The puck **must** be draggable anywhere within the disk boundary. The disk boundary **must** clamp the puck so it cannot be dragged outside the circle.
- Each wheel **must** have an outer luma ring that controls a master brightness scalar for that tonal range. The neutral (default) position **must** be visually marked. The ring **must** respond to both circular (rotational) drag along its arc and vertical drag anywhere on it.
- Below each wheel, **four numeric fields** (M, R, G, B) **must** reflect the current puck position and luma ring value in real time. Editing a channel field directly moves the puck/ring to the corresponding position.
- Scrolling over a numeric field **must** increment or decrement that parameter.
- Each wheel **must** have a **reset button** that restores the puck to center and the luma ring to neutral, zeroing all four numeric fields for that wheel.
- The Lift wheel **must** map its color and luma values to a shadow-weighted tonal shift applied most strongly to dark pixels.
- The Gamma wheel **must** map its values to a midtone-weighted tonal shift applied most strongly to mid-luminance pixels.
- The Gain wheel **must** map its values to a highlight-weighted tonal shift applied most strongly to bright pixels.
- The Offset wheel **must** add a flat color and brightness offset to all pixels regardless of luminance.

### Top Row Controls

- The panel **must** expose a **Temp** control: range −100 to +100, default 0. Negative values shift the layer toward cooler (blue) tones; positive values toward warmer (orange/yellow) tones.
- The panel **must** expose a **Tint** control: range −100 to +100, default 0. Negative values add a green cast; positive values add a magenta cast.
- The panel **must** expose a **Contrast** control: range 0 to 2, default 1.0. Values above 1.0 expand tonal range around the Pivot point; values below 1.0 compress toward it. At exactly 1.0 contrast is unchanged.
- The panel **must** expose a **Pivot** control: range 0 to 1, default 0.435. This is the luminance value held fixed when contrast is scaled — pixels at this luminance are unaffected; pixels above/below are pushed outward (or inward at Contrast < 1.0).
- The panel **must** expose a **Mid/Detail** control: range −100 to +100, default 0. Positive values add local contrast (clarity) to midtone regions; negative values soften midtone edges.
- Each top-row control **must** have a slider and a numeric input that remain in sync.

### Bottom Row Controls

- The panel **must** expose a **Color Boost** control: range 0 to 100, default 0. It **must** behave as a vibrance-style selective saturation boost — pixels with low existing saturation receive a proportionally larger boost than already-vivid pixels. At 0 there is no effect.
- The panel **must** expose a **Shadows** control: range −100 to +100, default 0. Positive values lift shadow tones (increase brightness in dark areas); negative values crush them. This is independent of the Lift wheel.
- The panel **must** expose a **Highlights** control: range −100 to +100, default 0. Positive values brighten highlight areas; negative values roll off (darken) the highlights. This is independent of the Gain wheel.
- The panel **must** expose a **Saturation** control: range 0 to 100, default 50. The midpoint (50) is neutral — no saturation change. Values above 50 uniformly increase saturation; values below 50 uniformly decrease it toward grayscale.
- The panel **must** expose a **Hue** control: range 0 to 100, default 50. The midpoint (50) is neutral — no hue rotation. Values above 50 rotate hue in one direction; values below 50 rotate in the opposite direction.
- The panel **must** expose a **Lum Mix** control: range 0 to 100, default 100. At 100, the full corrected color result is used. At 0, the color correction is applied in luminosity blending mode — only luminance is changed, not hue/saturation. Intermediate values blend between these two outcomes.
- Each bottom-row control **must** have a slider and a numeric input that remain in sync.

### General

- All controls **must** have a slider and a numeric input that remain in sync; values outside the allowed range **must** be clamped on commit.
- The canvas **must** update in real time as any control is adjusted.
- Double-clicking the puck **must** reset that wheel's color (hue + chroma) to center without affecting its luma ring.
- Double-clicking any numeric field **must** reset that individual parameter to its default value.
- Closing the panel **must** record exactly one undo history entry covering the final state of all parameters. Undoing **must** remove the adjustment layer.
- The adjustment layer **must** support visibility toggle, deletion, and re-editing from the Layer Panel.
- Fully transparent pixels (alpha = 0) **must** remain fully transparent regardless of any parameter values.

## Acceptance Criteria

- After creating the adjustment with all parameters at their defaults, the canvas appearance is visually identical to the unmodified parent layer.
- Dragging the Lift wheel puck toward red casts a visible red tint in the shadow regions; dragging toward blue casts a blue tint in the shadows.
- Dragging the Gain wheel puck toward yellow casts a yellow tint in the highlights; dragging toward cyan casts a cyan tint in the highlights.
- Dragging the Offset wheel puck adds an equal color cast across all tonal ranges regardless of luminance.
- Dragging the Gamma luma ring clockwise brightens midtones; dragging counter-clockwise darkens midtones.
- The four numeric fields (M, R, G, B) under each wheel update in real time while dragging the puck or ring.
- Typing a value into a wheel's R field moves the puck to the corresponding horizontal position on the disk.
- Pressing the reset (↺) button on a wheel returns its puck to center and its luma ring to neutral; the four numeric fields all read their default neutral values.
- Setting Temp to +100 produces a noticeably warmer (orange-shifted) result; −100 produces a noticeably cooler (blue-shifted) result.
- Setting Tint to +100 adds a visible magenta cast; −100 adds a visible green cast.
- Setting Contrast to 2.0 with default Pivot increases tonal separation (bright areas become brighter, dark areas become darker) around the pivot luminance level.
- Setting Contrast to 1.0 and Pivot to any value produces output identical to the unmodified parent.
- Setting Saturation to 100 (maximum) increases color intensity across all pixels; setting it to 0 produces a fully desaturated result; setting it to 50 produces no change.
- Setting Hue to 50 produces no hue shift; values above 50 rotate hue in one direction; values below 50 rotate in the opposite direction.
- Setting Lum Mix to 0 with a strong color correction applied allows luminance to shift with the correction; setting Lum Mix to 100 preserves the original luminance profile while the correction is still visible.
- Color Boost at 0 has no effect; increasing Color Boost on a layer with a mix of muted and vivid pixels causes a proportionally larger saturation increase in the muted areas.
- Shadows at +100 visibly lifts the darkest tones; Shadows at −100 crushes them toward black.
- Highlights at +100 brightens the brightest tones; Highlights at −100 rolls them off toward mid-gray.
- Creating the adjustment while a selection is active restricts the visible effect to that area; pixels outside it are unaffected.
- Creating the adjustment with no active selection applies the effect to the full layer.
- Hiding the adjustment layer removes the visual effect without deleting it.
- Deleting the adjustment layer removes it from the Layer Panel and the canvas returns to the unmodified parent appearance.
- Pressing Ctrl+Z once after closing the panel removes the adjustment layer entirely.
- Clicking the adjustment layer in the Layer Panel reopens the panel with all previously saved values exactly restored, including all four wheel states and all slider values.
- Double-clicking the puck on any wheel resets only that wheel's hue and chroma to neutral; its luma ring value is unchanged.
- Double-clicking a numeric field resets only that parameter to its default value; all other parameters are unchanged.
- Typing a value of 150 into a control with a maximum of 100 is clamped to 100; typing −150 into a control with a minimum of −100 is clamped to −100.
- Typing a value of 2.5 into Contrast is clamped to 2.0; typing −0.1 is clamped to 0.

## Edge Cases & Constraints

- Fully transparent pixels (alpha = 0) remain fully transparent regardless of any Color Grading parameter values.
- Achromatic pixels (R = G = B) placed under a wheel color shift gain the specified cast because Color Grading operates on absolute channel values, not HSL hue.
- The Saturation bottom-row control and the per-wheel chroma adjustments both affect color intensity but operate at different stages of the pipeline; they combine multiplicatively, so large values of both can produce extreme results.
- The Hue control (bottom row) and the per-wheel color shifts both affect apparent hue but via different mechanisms; the user is responsible for understanding their combined effect.
- The Lift, Gamma, Gain, and Offset wheels interact with the Shadows/Highlights sliders (bottom row), which operate on the same tonal regions. Their effects accumulate.
- Out of scope for v1: per-channel curves embedded in this panel — the separate [Curves](curves.md) adjustment must be used for that.
- Out of scope for v1: HDR or float-precision output beyond 8-bit per channel.
- Multiple Color Grading adjustments may be stacked on the same parent layer; each is independent.
- The adjustment is not applicable to text layers, shape layers, or mask layers.
- The selection mask baked at creation time does not update if the user modifies the selection after the adjustment layer has been created.
- There is no keyboard shortcut assigned to this adjustment by default.
- The floating panel is wider than most adjustment panels due to the four color wheels; on very small displays or when the canvas is maximized the panel may partially overlap the canvas, which is acceptable behavior.

## Related Features

- [adjustment-menu.md](adjustment-menu.md) — the menu entry that creates this adjustment
- [brightness-contrast.md](brightness-contrast.md) — complementary simple luminance/contrast adjustment
- [color-balance.md](color-balance.md) — simpler tonal-range color shifting (shadow/midtone/highlight tabs)
- [hue-saturation.md](hue-saturation.md) — complementary global hue rotation and saturation adjustment
- [color-vibrance.md](color-vibrance.md) — complementary selective saturation adjustment (overlaps with Color Boost)
- [curves.md](curves.md) — complementary per-channel tonal curve adjustment
- [color-temperature.md](color-temperature.md) — simpler standalone temperature/tint adjustment
- Layer Panel → Layer Masks (child-layer structure this adjustment shares)
