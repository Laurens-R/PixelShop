# Object Selection Tool

## Overview

The Object Selection Tool is a smart, AI-assisted selection tool that uses a locally-cached MobileSAM (Segment Anything Model — lightweight ONNX variant, ~40 MB) to detect and precisely mask objects in the image. Instead of requiring the user to carefully trace an outline, the user either draws a rough bounding box or clicks inside an object, and the model infers a pixel-accurate selection that follows the object's real edges. This dramatically lowers the effort needed to isolate complex subjects such as hair, foliage, or irregular silhouettes.

---

## User Interaction

### First Launch — Model Download

1. When the user activates the Object Selection Tool for the first time (model not yet cached), the options bar shows a **"Download model (~40 MB)"** button in place of the normal options.
2. Clicking the button initiates a download of the two MobileSAM ONNX files (image encoder and mask decoder) from the official HuggingFace MobileSAM repository.
3. A download progress indicator replaces the button in the options bar for the duration of the download.
4. Once the download is complete the files are cached permanently in `{userData}/models/mobilesam/` and the tool becomes fully operational without any restart.
5. If the download fails, an error message is shown in the options bar with a **Retry** button.

### Toolbar Placement & Shortcut

- The tool appears in the toolbar **between the Lasso and the Magic Wand** tools.
- Keyboard shortcut: **W**. Pressing W when the Magic Wand is active switches to the Object Selection Tool; pressing W again switches back. The two tools cycle on each W press.

### Rectangle Mode (Default)

1. The user selects **Rectangle** from the prompt-mode selector in the options bar (this is the default).
2. The user drags a bounding box over the subject they want to select. While dragging, a dashed rectangle overlay is drawn on the canvas at the current drag bounds — identical in appearance to the Rectangular Marquee bounding-box preview.
3. On pointer-up the tool submits the bounding box as a prompt to the MobileSAM mask decoder. An **"Analyzing…"** indicator appears in the options bar while inference runs.
4. When inference completes the resulting mask is committed to `selectionStore` using the active Selection Mode (New / Add / Subtract / Intersect). The selection renders as the standard marching-ants outline.
5. Feather and Anti-alias (see Options Bar) are applied to the model's raw output mask before it is committed.

### Point Prompt Mode

1. The user selects **Point** from the prompt-mode selector in the options bar.
2. **Left-click** inside an object adds a **positive prompt point** (include region) shown as a filled green dot on the canvas overlay.
3. **Alt+click** adds a **negative prompt point** (exclude region) shown as a filled red dot on the canvas overlay.
4. After the first point is placed, the tool immediately runs inference and shows a preliminary selection as marching ants. Subsequent point additions refine the selection; inference is re-run automatically, debounced by ~300 ms, so rapid clicks do not each trigger a separate model run.
5. The user may accumulate any number of positive and negative points before committing.
6. When satisfied, the user **commits** the selection by pressing **Enter** or clicking the **✓ (Commit)** button in the options bar. The mask is applied to `selectionStore` using the active Selection Mode. Point prompt overlays are cleared.
7. **Backspace** or **Delete** removes the most recently added point prompt and re-runs inference with the remaining prompts (debounced ~300 ms).
8. **Escape** cancels the in-progress selection, clears all point prompts from the canvas overlay, and leaves the previous selection (if any) unchanged.

### Select Subject (One-Click)

1. The user clicks the **Subject** button in the options bar.
2. The tool encodes the entire image and runs the MobileSAM decoder with no user prompts, asking the model to auto-detect the most prominent subject.
3. An **"Analyzing…"** indicator appears in the options bar while inference runs.
4. The resulting mask is committed to `selectionStore` using the active Selection Mode, with Feather and Anti-alias applied. No overlay prompts are shown.

---

## Functional Requirements

### Model Management
- The MobileSAM ONNX files **must** be downloaded on first use and stored permanently at `{userData}/models/mobilesam/`.
- All model download and cache management **must** be handled through Electron IPC; the renderer **must not** perform direct file-system access.
- While the model files are absent, the tool **must** show a download prompt in the options bar and **must not** allow drawing on the canvas.
- Download progress **must** be surfaced to the user in the options bar as a percentage or progress bar.
- If a download fails or is interrupted, a **Retry** button **must** be provided; partial files **must** be cleaned up before retrying.

### Inference
- Inference **must** run locally on the user's machine using ONNX Runtime; no network call **must** be made for inference.
- The image encoder pass runs once per image encode session. The mask decoder runs per prompt interaction.
- While inference is running the tool **must** display an **"Analyzing…"** indicator in the options bar.
- If inference fails (model error, out-of-memory, etc.) an error toast **must** be shown and no selection change **must** be made.

### Prompt & Interaction
- In Rectangle mode, the bounding-box drag overlay **must** use the same dashed-rectangle visual as the Rectangular Marquee tool preview.
- In Point mode, positive prompt points **must** render as filled green dots; negative prompt points as filled red dots. Both **must** be drawn on the canvas overlay layer (not burned into pixel data).
- Point overlays **must** be cleared when the selection is committed or cancelled.
- In Point mode, inference **must** be debounced so that it does not re-fire more often than once every ~300 ms.
- **Backspace / Delete** in Point mode **must** remove the last added prompt point and re-run inference (debounced).
- **Escape** **must** cancel any in-progress bounding-box drag or point-prompt session and leave `selectionStore` unchanged.
- **Enter** in Point mode **must** commit the current inferred mask to `selectionStore`.

### Mask Output & Selection Integration
- The raw mask from MobileSAM **must** be post-processed with the current **Anti-alias** and **Feather** settings before being written to `selectionStore`.
- When Anti-alias is enabled, sub-pixel edge smoothing **must** be applied to the mask boundary (equivalent to a 1 px Gaussian when feather is 0).
- Feather values greater than 0 **must** apply a Gaussian blur of the specified radius (in pixels) to the mask.
- The final mask **must** be combined with the existing selection in `selectionStore` according to the active **Selection Mode** (`set` / `add` / `subtract` / `intersect`).
- The committed selection **must** render as a standard marching-ants outline, identical to selections produced by other selection tools.

### Options Bar
- The options bar **must** contain, from left to right: **Selection Mode** buttons (New / Add / Subtract / Intersect), a **Prompt Mode** selector (Rectangle / Point), a **Feather** slider (0–100 px), an **Anti-alias** checkbox (default: on), and a **Subject** button.
- When the model is not yet downloaded, the options bar **must** show only a download prompt; normal options **must** not be accessible until the model is ready.

---

## Acceptance Criteria

- Activating the Object Selection Tool for the first time (no cached model) shows a "Download model (~40 MB)" button in the options bar; no other tool options are shown.
- Clicking the download button starts the download and replaces the button with a progress indicator. The tool cursor is inert during the download.
- After download completes the full options bar appears and the tool is immediately usable without a restart.
- In Rectangle mode, dragging on the canvas displays a dashed bounding-box preview overlay that updates live as the mouse moves.
- Releasing the drag triggers inference; an "Analyzing…" indicator appears in the options bar while the model runs.
- After inference the marching-ants selection follows the edges of the subject inside the dragged rectangle, not the rectangle itself.
- In Point mode, left-clicking inside an object adds a green dot at the click location and triggers inference after the debounce period.
- Alt+clicking adds a red dot and triggers inference after the debounce period.
- The selection is refined (not replaced) on each new point addition — marching ants update to reflect the latest mask.
- Pressing Backspace removes the last-placed prompt dot and re-runs inference with the remaining prompts.
- Pressing Enter commits the current inferred mask; all prompt dots are cleared from the canvas overlay.
- Pressing Escape removes all prompt dots from the canvas overlay and leaves the previous `selectionStore` state unchanged.
- With Selection Mode set to **Add**, running inference and committing adds the new mask to the existing selection rather than replacing it.
- With Selection Mode set to **Subtract**, committing removes the new mask from the existing selection.
- With Feather set to 20 px, the committed mask has a 20 px soft edge.
- With Anti-alias checked (default), the mask boundary has sub-pixel smoothing; unchecking it produces a hard-edged mask.
- Clicking the **Subject** button with no user prompts runs inference and produces a selection around the dominant subject in the image.
- The selection produced by the Object Selection Tool is visually and functionally identical to selections from other tools: it responds to invert, deselect, transform, fill, and all other selection-dependent operations.
- Pressing **W** while the Magic Wand is active switches to the Object Selection Tool. Pressing **W** again switches back to the Magic Wand.

---

## Edge Cases & Constraints

- **Model absent at inference time:** If the cached model files are deleted or corrupted while the tool is active, inference fails with an error toast. The tool re-enters the "Download model" state.
- **No subject found:** If MobileSAM returns an empty or near-empty mask (e.g. the entire image is uniform colour, or Select Subject finds nothing), an informational toast is shown ("No subject found") and the selection is unchanged.
- **Very small canvas or selection area:** Bounding boxes smaller than 8 × 8 pixels are rejected with a tooltip warning; the user must drag a larger area.
- **Inference during an existing selection:** Committing a new mask respects the active Selection Mode. The user can build up complex selections across multiple inference runs by using Add mode.
- **Point mode with zero points committed:** Pressing Enter or clicking Commit with no prompts placed is a no-op.
- **Image encoder caching:** The image encoder output is cached for the current canvas state. Switching layers, applying adjustments, or painting invalidates the cache; the encoder re-runs on the next inference.
- **Large images:** For images larger than 4096 × 4096 px the image is downsampled to 1024 × 1024 before encoding (as required by MobileSAM); the resulting mask is upsampled back to the original canvas dimensions before being committed.
- **Undo:** Committing a selection produced by the Object Selection Tool is a single undoable step, consistent with all other selection tools. The prompt dots are not individually undoable.
- **Multi-document tabs:** Each document tab maintains its own in-progress prompt state and encoder cache independently. Switching tabs discards any uncommitted point prompts for the previous tab.
- **Out of scope:** Cloud inference, video/animated frame sequences, GrabCut-based fallback, and model fine-tuning are explicitly not supported.

---

## Related Features

- [Rectangular Marquee (select.md)](select.md) — shares the dashed bounding-box preview visual and Selection Mode semantics
- [Magic Wand (magic-wand — no dedicated spec)](../designs/find-layers.html) — shares the **W** keyboard shortcut cycling behavior
- [Lasso (lasso — no dedicated spec)] — adjacent tool in the toolbar
- [Content-Aware Fill](content-aware-fill.md) — a common downstream operation after object selection
- [Free Transform](free-transform.md) — frequently used after isolating a subject with the Object Selection Tool
