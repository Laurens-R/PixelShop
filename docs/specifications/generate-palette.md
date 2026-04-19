# Generate Palette

## Overview

The Generate Palette dialog lets users replace their entire swatch collection with a freshly generated set of colors. Rather than adding colors manually or through individual color-picker interactions, users can produce a complete, coherent palette in one step. Four generation modes cover the most common palette needs: color-theory schemes derived from a chosen hue, colors extracted from the currently open image, canonical hardware/retro palettes, and dark "night" variants of the existing palette.

---

## User Interaction

1. The user opens the **Swatches** tab in the right panel.
2. They click the **Generate palette** button near the top of the panel.
3. A modal dialog opens. A mode switcher at the top allows selection between four modes:
   - **Color Wheel**
   - **Extract from Image**
   - **Device Emulation**
   - **Night Color**
4. The user selects a mode. The dialog body updates to show the controls for that mode.
5. The user adjusts the available options for the selected mode (described per-mode below).
6. A live **preview** area shows the resulting color chips, grouped by hue in the same way the Swatches panel displays them.
7. The user clicks **Apply** to replace the current swatch collection with the previewed colors, or **Cancel** to close the dialog without making changes.
8. On Apply, the dialog closes and the Swatches panel immediately reflects the new palette.

---

## Modes

### Color Wheel (Color Theory)

The user generates a set of colors based on established color-theory relationships radiating from a single base hue.

**Controls:**
- **Base hue** — a hue picker or numeric input (0–360°) to set the root color.
- **Scheme type** — a selector offering: Complementary, Analogous, Triadic, Tetradic, Split-Complementary.
- **Number of colors** — a numeric input or slider controlling how many colors are generated (minimum 2, maximum dependent on scheme type).
- **Saturation** — a slider (0–100%) applied uniformly to all generated colors.
- **Lightness** — a slider (0–100%) applied uniformly to all generated colors.

**Behavior:**
- The scheme type determines which hue angles are derived from the base hue.
- Generated colors are perceptually harmonious; hue angles are distributed according to the chosen scheme geometry.
- Saturation and lightness are applied as HSL parameters and affect all colors in the output uniformly.

---

### Extract from Image

The user derives a palette from the pixel content of the currently open image. The extraction uses perceptual color clustering (k-means in CIELAB or OKLab space) so that the resulting swatches faithfully represent the dominant visual colors in the image rather than the most-frequent raw pixel values.

**Controls:**
- **Color count** — a slider selecting how many colors to extract (2–256).

**Behavior:**
- The image is analyzed using a WASM-based clustering algorithm operating in a perceptually uniform color space.
- After clustering, duplicate or near-duplicate colors are removed.
- The final color set is sorted by hue before appearing in the preview.
- This mode is only available when an image is currently open. If no image is open, the mode is disabled or shows an explanatory message.

---

### Device Emulation

The user selects a named legacy hardware platform and receives its exact canonical color palette.

**Controls:**
- **Device** — a list or dropdown with the following options:

  | Device | Colors |
  |---|---|
  | CGA | 16 |
  | EGA | 64 |
  | Commodore 64 | 16 |
  | Game Boy | 4 |
  | ZX Spectrum | 16 |
  | NES | 54 |

**Behavior:**
- Selecting a device immediately populates the preview with the exact canonical palette for that hardware — no adjustable parameters.
- The color values are fixed reference values and are not altered by user input.

---

### Night Color

The user derives a dark, muted companion palette from the colors already in their current swatch collection. The original colors are retained and each is extended with a series of progressively darker and more desaturated "night" variants.

**Controls:**
- **Night steps per color** — a slider or numeric input (2–4) controlling how many dark variants are generated for each existing color.

**Behavior:**
- The output palette contains all original swatches plus their night variants.
- Night variants are produced by progressively reducing lightness and desaturating the original color, simulating how colors appear under low-light or moonlit conditions.
- Variants for each source color are kept adjacent in the preview, ordered from the least to the most muted.
- If the current swatch collection is empty, this mode is disabled or shows an explanatory message.

---

## Functional Requirements

- The dialog must be modal; all interaction is blocked behind it until the user applies or cancels.
- Switching between modes must preserve the mode-specific control values for the session (i.e. returning to a mode restores the last-used settings within the same dialog open).
- The preview area must update synchronously (or near-synchronously) whenever any control value changes, reflecting exactly the palette that Apply would produce.
- Colors in the preview must be grouped and sorted by hue using the same algorithm as the Swatches panel's display order: chromatic colors in spectral sequence, neutrals grouped together.
- Clicking **Apply** must replace the entire swatch collection atomically. The previous collection is discarded.
- Clicking **Cancel** or pressing Escape must close the dialog with no changes to the swatch collection.
- Apply must be undoable via the standard undo history so the user can restore the previous palette with Ctrl/Cmd+Z.
- The **Extract from Image** mode must be disabled (with a user-visible explanation) when no image document is open.
- The **Night Color** mode must be disabled (with a user-visible explanation) when the current swatch collection is empty.
- The dialog must not modify any aspect of the document or canvas — only the swatch collection.

---

## Acceptance Criteria

- Opening the dialog from the **Generate palette** button displays the mode switcher and defaults to one of the four modes.
- Selecting **Color Wheel** and changing the base hue or scheme type immediately updates the preview.
- Selecting **Complementary** scheme with a base hue of 0° produces two hue families approximately 180° apart.
- Selecting **Extract from Image** with a color count of 8 and clicking Apply results in exactly 8 swatches in the panel (after deduplication, which may yield fewer if the image lacks sufficient distinct colors).
- Selecting **Device Emulation → Game Boy** shows exactly 4 colors in the preview matching the canonical Game Boy palette.
- Selecting **Device Emulation → NES** shows exactly 54 colors in the preview.
- Selecting **Night Color** with 3 steps on a 5-swatch collection produces a preview showing 5 original swatches plus 15 night variants (5 × 3).
- After clicking Apply, the Swatches panel displays only the newly generated colors — no colors from the previous palette remain unless they happen to be in the generated set.
- After clicking Apply and then pressing Ctrl/Cmd+Z, the previous swatch collection is restored.
- Clicking Cancel at any point leaves the swatch collection unchanged.
- The preview grid groups colors by hue in the same visual order as the Swatches panel (spectral sequence for chromatics, neutrals together).
- When no image is open, the **Extract from Image** mode tab is visually disabled and cannot be activated.
- When the swatch collection is empty, the **Night Color** mode tab is visually disabled and cannot be activated.

---

## Edge Cases & Constraints

- **Extract from Image on a very uniform image** (e.g. a solid-color fill): the clustering may return fewer distinct colors than the requested count. The preview and resulting palette must reflect the actual number of distinct colors found, not pad with duplicates.
- **Night Color on a palette that already contains very dark colors**: generated night variants may be indistinguishable from the source color or from each other. The result is valid; no deduplication is required for Night Color mode.
- **Color Wheel with a very high color count**: the scheme geometry limits meaningful hue diversity. The system must still produce the requested count (distributing lightness or saturation steps as needed) without error.
- **Device Emulation palettes** may contain colors that appear nearly identical to the eye; all canonical values must be preserved exactly even if visually duplicate.
- The preview area must handle up to 256 color chips without layout overflow — chips must wrap into additional rows rather than overflow the dialog horizontally.
- The dialog's Apply action is a destructive replacement. No merge or append mode exists in this version.

---

## Related Features

- [docs/specifications/swatches-scroll-grouping.md](swatches-scroll-grouping.md) — defines the hue-grouping sort applied in both the panel and the dialog preview.
- [docs/specifications/color-grading.md](color-grading.md) — related color management surface.
- [docs/specifications/curves.md](curves.md) — related color adjustment context.
