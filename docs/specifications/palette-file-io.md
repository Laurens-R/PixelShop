# Palette File I/O

## Overview

The Palette File I/O feature lets users save their current swatch collection to a `.palette` file on disk and reload it in a later session or share it with others. A hamburger menu (≡) button in the Swatches panel header exposes Save, Save As, and Open commands, backed by Electron's native file dialogs so the interaction feels consistent with the rest of the operating system.

## User Interaction

1. The user opens the **Swatches** tab in the right panel's color section.
2. In the panel header row, a **≡ (hamburger) menu button** is visible alongside the existing panel controls.
3. The user clicks the ≡ button. A context menu appears with three items:
   - **Save Palette**
   - **Save Palette As…**
   - **Open Palette…**

### Save Palette

4. If a `.palette` file is already associated with the current session (i.e., the user has previously saved or opened a palette file), the current swatches are written to that same file immediately — no dialog appears.
5. If no file is associated yet, the behavior falls through to **Save Palette As…**.

### Save Palette As…

6. A native OS Save dialog opens, pre-filtered to `.palette` files.
7. The user chooses a folder and filename, then confirms.
8. The swatches are serialized to JSON and written to the chosen path. That path becomes the new "last used" file for the current session, so a subsequent **Save Palette** writes to it without prompting again.
9. If the user cancels the dialog, no file is written and the last-used path is unchanged.

### Open Palette…

10. A native OS Open dialog appears, pre-filtered to `.palette` files.
11. The user selects a file and confirms.
12. The file is read and parsed. The current swatch collection is **replaced** with the swatches from the file.
13. The opened file path becomes the new last-used file for the current session, so a subsequent **Save Palette** writes back to that same file.
14. If the user cancels the dialog, the current swatches are unchanged.

## Functional Requirements

- The ≡ menu button must appear in the Swatches panel header row and must not displace or overlap any existing controls.
- The context menu must contain exactly these three items in order: **Save Palette**, **Save Palette As…**, **Open Palette…**.
- **Save Palette** must write to the last-used `.palette` path without showing a dialog. If no last-used path exists, it must behave identically to **Save Palette As…**.
- **Save Palette As…** must always present a native Save dialog, regardless of whether a last-used path exists.
- **Open Palette…** must present a native Open dialog and replace the current swatches with those from the selected file.
- Native file dialogs must be opened via the Electron main process over IPC; the renderer must not attempt direct filesystem access.
- The `.palette` file format must be JSON with the following schema:
  ```json
  { "version": 1, "swatches": [{ "r": 255, "g": 0, "b": 0, "a": 255 }, …] }
  ```
  All four channels (`r`, `g`, `b`, `a`) are integers in the range 0–255.
- After a successful **Open Palette…**, the application state's swatch list must be fully replaced; no merging with the previous swatches occurs.
- The last-used file path must be tracked per-session only; it need not persist across application restarts.
- If a file cannot be read or parsed (malformed JSON, missing `swatches` key, invalid channel values), the operation must be aborted and the current swatches must remain unchanged. An error must be surfaced to the user.

## Acceptance Criteria

- The ≡ button is visible in the Swatches panel header at all times (when the Swatches tab is active).
- Clicking ≡ opens a menu with exactly the three expected items.
- **Save Palette As…** opens a native Save dialog filtered to `.palette` files; confirming it writes a valid JSON file to the chosen path.
- Opening the saved `.palette` file with any JSON viewer shows the correct `version` and `swatches` structure matching the swatches that were saved.
- **Save Palette** (after a prior save or open) writes to the same file without a dialog.
- **Save Palette** (with no prior association) opens a native Save dialog.
- **Open Palette…** opens a native Open dialog filtered to `.palette` files; confirming it replaces all swatches in the panel with those from the file.
- Cancelling the Save dialog leaves the swatch list and last-used path unchanged.
- Cancelling the Open dialog leaves the swatch list unchanged.
- Loading a `.palette` file with a corrupted or unexpected structure does not crash the application and does not alter the existing swatches.
- After opening a palette file, a subsequent **Save Palette** overwrites that same file without prompting.

## Edge Cases & Constraints

- If the swatch list is empty, **Save Palette As…** writes a valid file with `"swatches": []`. This is intentional — saving an empty palette is a valid action.
- Semi-transparent swatches (alpha < 255) must round-trip correctly through the file format; no alpha information should be lost.
- The last-used path is not persisted to disk between application sessions. Starting a new session always begins without an associated file.
- Very large palettes (hundreds of swatches) must not block the UI during serialization or deserialization; the JSON read/write operations are expected to complete fast enough at realistic palette sizes that no progress indicator is required.
- The ≡ menu is specific to the Swatches tab. It does not appear on the Color Picker or Navigator tabs.

## Related Features

- [Swatches Panel: Scrolling and Hue Grouping](swatches-scroll-grouping.md) — describes the swatch grid layout and sorting behavior that determines how imported swatches are displayed after an **Open Palette…**.
- [Generate Palette](generate-palette.md) — populates the swatch list from image content; its output can subsequently be saved via **Save Palette As…**.
