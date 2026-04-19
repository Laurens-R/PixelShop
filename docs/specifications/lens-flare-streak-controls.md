# Lens Flare – Streak Width & Streak Rotation Controls

## Overview

Two new sliders — **Streak Width** and **Streak Rotation** — extend the existing Lens Flare dialog to give the user direct control over the shape and angular orientation of streak rays. Previously, streak appearance was fixed per lens type; with these controls the user can make streaks thin and knife-like or broad and diffuse, and can freely rotate them to align with the composition without repositioning the flare center. Both controls apply to all five lens types.

## User Interaction

1. The user opens the **Lens Flare** dialog via **Filter → Render → Lens Flare…** as before.
2. In the right-side controls column, two new sliders appear below the existing **Streaks** slider:
   - **Streak Width** — a slider with a paired numeric input.
   - **Streak Rotation** — a slider with a paired numeric input.
3. The user adjusts **Streak Width** by dragging its slider or typing a value. The preview updates after a short debounce delay. The streaks grow fatter (wider angular spread) as the value increases, or thin to crisp needle-like spokes as the value decreases.
4. The user adjusts **Streak Rotation** by dragging its slider or typing a value. The preview updates after the same debounce delay. The entire streak pattern rotates around the flare center; at 0° the streaks sit in the lens type's natural orientation, and increasing the value rotates them clockwise.
5. When the user changes the **Lens Type**, both sliders reset to that lens type's per-type default values and the preview updates immediately.
6. Clicking **Apply** bakes the chosen Streak Width and Streak Rotation into the rendered flare layer, along with all other current parameter values.

## Functional Requirements

- The dialog **must** expose two new controls in the right-side controls panel, placed directly below the existing **Streaks** slider:
  - **Streak Width**: integer slider and numeric input, range **1–100** (inclusive), unit "%". The value scales the angular spread of each streak ray relative to the natural width for that lens type.
  - **Streak Rotation**: integer slider and numeric input, range **0–359** (inclusive), unit "°". The value rotates the entire streak pattern clockwise around the flare center, in degrees.
- Each lens type **must** have a distinct default for Streak Width that preserves the current natural streak appearance of that type:

  | Lens Type              | Streak Width default | Streak Rotation default |
  |------------------------|----------------------|------------------------|
  | 50–300mm Zoom          | 50                   | 0                      |
  | 35mm Prime             | 25                   | 0                      |
  | 105mm Prime            | 75                   | 0                      |
  | Movie Prime            | 30                   | 0                      |
  | Cinematic (Anamorphic) | 20                   | 0                      |

- Streak Rotation **must** default to 0° for all lens types.
- When the **Lens Type** changes, **both** Streak Width and Streak Rotation **must** reset to the new type's defaults and the preview **must** update immediately (no debounce).
- Adjusting either **Streak Width** or **Streak Rotation** **must** trigger a debounced preview update (approximately 150 ms after the last change), consistent with how Brightness, Rings, and Streaks behave.
- Values entered outside the valid range **must** be clamped:
  - Streak Width below 1 is set to 1; above 100 is set to 100.
  - Streak Rotation below 0 is set to 0; above 359 is set to 359.
- Both controls **must** be passed to the GPU shader alongside all existing parameters and **must** affect the full-resolution output rendered on **Apply**, not only the preview.
- Both controls **must** apply to all five lens types, including Cinematic (Anamorphic). For the Anamorphic type, Streak Width controls the vertical thickness of the horizontal streak band, and Streak Rotation tilts that band away from horizontal.

## Acceptance Criteria

- The Lens Flare dialog displays a **Streak Width** slider and numeric input below the Streaks slider, and a **Streak Rotation** slider and numeric input below Streak Width.
- On dialog open, Streak Width is set to the active lens type's default value (50 for 50–300mm Zoom), and Streak Rotation is set to 0.
- Changing the Lens Type resets both sliders to the new type's defaults and updates the preview immediately.
- Setting Streak Width to 1 produces visibly thin, sharp streaks; setting it to 100 produces wide, soft, spread-out streak rays. The lens character of each type remains recognizable at both extremes.
- Setting Streak Rotation to 45° visibly rotates all streak spokes 45° clockwise from their default orientation.
- Setting Streak Rotation to 0° and 360° (i.e. 0° after clamping from 360°) produces the same result as the natural orientation.
- For the Cinematic (Anamorphic) type, Streak Rotation at 0° produces a purely horizontal streak. Rotating to 90° produces a vertical streak. Rotating to 45° tilts the streak diagonally.
- Moving either slider does not trigger a preview redraw on every pixel of movement — it waits approximately 150 ms after the user settles.
- Clicking **Apply** produces a full-resolution flare that matches the preview's streak width and rotation.
- Typing 0 in the Streak Width input results in 1; typing 150 results in 100.
- Typing −5 in the Streak Rotation input results in 0; typing 400 results in 359.
- Undo after **Apply** removes the lens flare layer exactly as it did before these controls were added (single undo step, no additional history entries for slider interactions).

## Edge Cases & Constraints

- At Streak Width = 1 and Streaks slider = 0, streaks are invisible regardless of Streak Width — Streak Width controls spread, not intensity.
- Streak Rotation has no visual effect when the Streaks slider is at 0, since there are no streak rays to rotate.
- For the Cinematic (Anamorphic) type, Streak Rotation near 90° makes the horizontal streak band vertical. Because the anamorphic streak spans the full canvas length, a rotated streak at 90° spans the full canvas height instead. This is expected.
- Streak Rotation wraps visually: 0° and 360° (clamped to 359°) produce near-identical results due to the periodic nature of rotational symmetry in multi-spoke patterns. For symmetric patterns (e.g. 35mm Prime with 8 equally-spaced spokes), a 45° rotation returns to a visually equivalent state.
- The per-type defaults for Streak Width are calibrated to reproduce the streak appearance baked into the original shaders before these controls were introduced. A user who never touches the new sliders sees no change in the flare's appearance.
- The preview thumbnail reflects Streak Width and Streak Rotation at reduced resolution. Minor visual differences between the preview and the full-resolution output are acceptable, but the rotation angle and approximate width must be clearly represented.

## Related Features

- [lens-flare.md](lens-flare.md) — the full Lens Flare filter specification; these controls are an addendum to that feature
- [filters-menu.md](filters-menu.md) — the Filters menu that hosts the Lens Flare item
- [unified-rasterization-pipeline.md](unified-rasterization-pipeline.md) — compositing pipeline governing how the new layer composites with layers below it
