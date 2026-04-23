# Content-Aware Fill – Sampling Area Control

## Overview

By default, Content-Aware Fill and Content-Aware Delete sample patches from the entire image when reconstructing the selected region. For photos with strong spatial context — a road stripe, a wall crack, a sky gradient — sampling irrelevant areas of the image degrades the result. Sampling Area Control lets the user constrain which pixels the PatchMatch algorithm may draw from by specifying how close to the selection boundary candidate source pixels must be. This produces significantly cleaner fills by preventing patches from distant, contextually unrelated image regions from being used.

---

## User Interaction

1. The user creates a selection over the area to fill or delete.
2. The user invokes **Edit → Content-Aware Fill** or **Edit → Content-Aware Delete** (or presses **Shift+Delete** / **Shift+Backspace**).
3. Instead of immediately running the fill, a small **Sampling Options dialog** appears.
4. The dialog contains:
   - A **Sampling Radius** numeric field (integer, pixels), pre-populated with the default value of **200**.
   - A brief description: *"Only pixels within this distance of the selection boundary will be used as source material. Set to 0 to sample the entire image."*
   - A **Cancel** button.
   - A **Fill** button (when invoked from Content-Aware Fill) or a **Delete** button (when invoked from Content-Aware Delete).
5. The user may:
   - Adjust the sampling radius, then click **Fill** / **Delete** to proceed.
   - Click **Cancel** to dismiss the dialog — no fill runs, no layers are modified.
6. After clicking **Fill** / **Delete**, the dialog closes and the fill runs exactly as it did before, with the constraint applied. The existing progress indicator and result behaviour are unchanged.

---

## Functional Requirements

- The Sampling Options dialog **must** appear before every Content-Aware Fill and Content-Aware Delete invocation. It replaces the previous immediate-execution behaviour.
- The dialog **must** contain a single integer input field labelled **Sampling Radius** with a unit label of **px**.
- The minimum accepted radius value is **0** (meaning: no spatial constraint; sample the entire image outside the selection). This preserves the previous default behaviour.
- The maximum accepted radius value is unconstrained by the UI, but values larger than the image's largest dimension are functionally equivalent to 0.
- The default radius value **must** be **200 px**.
- The dialog **must** have a **Cancel** button that closes the dialog and takes no further action — the active layer and layer stack remain unchanged.
- The dialog **must** have a primary action button labelled:
  - **Fill** when triggered from Content-Aware Fill.
  - **Delete** when triggered from Content-Aware Delete.
- Pressing **Enter** while the dialog is focused must trigger the primary action.
- Pressing **Escape** must trigger Cancel.
- When radius > 0, the algorithm's eligible source region is the set of pixels that are:
  - **outside** the selection mask, AND
  - within **N pixels** (Euclidean distance) of the selection boundary.
- When radius = 0, the algorithm's eligible source region is all pixels outside the selection mask (same as the original unconstrained behaviour).
- If the eligible source region computed from radius > 0 is **empty or too small** (fewer pixels than one patch window), the operation must be aborted and an error toast shown: *"Sampling radius is too small — no source pixels available. Try a larger radius or set it to 0."*
- The source region constraint is expressed as a **`sourceMask`** — a binary mask the same dimensions as the canvas — passed to the WASM inpainting layer. Pixels set to `1` in the mask are eligible source pixels; pixels set to `0` are not. This abstraction must be the single interface point between the UI layer and the WASM layer for source region control.
- All other fill behaviour (progress indicator, new layer creation, layer naming, undo atomicity, selection preservation, active layer selection after fill) is **unchanged** from the base Content-Aware Fill / Delete spec.

---

## Acceptance Criteria

- Invoking Content-Aware Fill or Content-Aware Delete opens the Sampling Options dialog before any computation begins.
- The Sampling Radius field is pre-filled with 200.
- Clicking **Cancel** closes the dialog; no layers are modified and no computation runs.
- Pressing **Escape** behaves identically to clicking Cancel.
- Setting the radius to 0 and clicking Fill/Delete produces the same result as the original unconstrained fill.
- Setting the radius to a positive integer N produces a fill that visually draws only from pixels near the selection boundary — patches from distant image regions should not appear in the filled area.
- Setting the radius so small that no source pixels exist shows an error toast and leaves the document unchanged.
- Pressing **Enter** in the dialog triggers the primary action (Fill or Delete).
- The primary button is labelled "Fill" for Content-Aware Fill and "Delete" for Content-Aware Delete.
- The fill result (new layer placement, transparency, active layer selection, undo behaviour) is identical to the base feature behaviour regardless of the sampling radius chosen.

---

## Edge Cases & Constraints

- **Radius larger than the image**: functionally equivalent to radius = 0; the eligible source region covers the entire area outside the selection. No special handling is required.
- **Radius = 1**: the source band is very narrow; on small or thin selections this can produce an empty source region. The empty-source guard (error toast) catches this case.
- **Non-contiguous selections**: the distance computation is measured from the nearest point on any part of the selection boundary, so non-contiguous selections each contribute their own surrounding band.
- **Selection touching the image edge**: pixels outside the canvas boundary are not valid source pixels. If the selection is flush with the canvas edge and the radius is small, the eligible source region may be smaller than expected.
- **Performance**: computing a distance-based `sourceMask` for a 4000 × 3000 canvas is fast (single CPU pass). It does not add perceptible latency before the progress indicator appears.
- **Sampling radius is not persisted** between sessions or between invocations within a session. It resets to 200 each time the dialog opens.

---

## Future Extension: User-Painted Sampling Area (Option B)

The `sourceMask` abstraction described above is designed to support a future painting-based workflow without changes to the WASM layer.

In Option B, after invoking Content-Aware Fill/Delete, the user would paint a green overlay directly onto the canvas to designate which pixels are eligible source pixels. The painted overlay is converted to a `sourceMask` binary mask, which is then passed to the same WASM inpainting entry point that Option A uses. No WASM changes are required to enable Option B — only a new UI mode for constructing the mask.

This option is **not part of the current feature scope** and is documented here only to confirm that the architecture supports it.

---

## Related Features

- [Content-Aware Fill & Delete](content-aware-fill.md) — the base feature this extends; all behaviour not described here defaults to that spec.
- [Selection tools](../specifications/) — lasso, marquee, magic wand; required to define the fill region.
- [Filters menu](filters-menu.md) — parallel pattern for operations with pre-run configuration dialogs and progress feedback.
