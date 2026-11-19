# Pixel Board and agent integration

Updated: 2026-11-19. Main-process Board integration and editor changes are local
to the Experience 5.2 worktree and have not been pushed.

## Ownership and synchronization

`src/main/board/service.ts` is the authoritative owner of the active
`PixelBoardDocument`. It stores a versioned envelope containing a document and
monotonic revision at `<userData>/boards/active-board.json`. The service
validates candidate documents, persists a candidate before publishing it,
keeps bounded undo/redo history, and rejects stale renderer revisions. Manual
Workspace edits and AI tool calls operate on this same state.

The renderer gets a typed `window.cyps.board` API through the sandboxed preload.
It subscribes to snapshots, queues its own pointer edits, and refuses to apply
an older snapshot over a newer revision. Agent changes notify the Workspace;
the Workspace navigates to Pixel Board when the agent changes or opens it.

Older `.pixelboard` documents remain readable. The former localStorage draft is
validated and imported only when the main-process Board is new; the old value
is intentionally left in place. A damaged persisted draft is not deleted.

## Model-facing tools

All tools are defined in `src/main/board/tools.ts`, included in the ordinary
`ToolRegistry` schema sent to the model, validated by the registry, and routed
through `AgentExecutor` to `ToolExecutors.runBoardTool`.

| Tool | Effect |
| --- | --- |
| `board_get_state` | Reads title, revision, object count and bounded object details. |
| `board_create` | Creates a named empty document if the active document has no work. |
| `board_add_text` | Adds wrapped editable text and chooses a non-overlapping row when coordinates are omitted. |
| `board_add_shape` | Adds line, arrow, rectangle or circle with bounded coordinates. |
| `board_add_stroke` | Adds a bounded pen/highlighter point list. |
| `board_add_marker` | Adds a numbered step marker. |
| `board_create_diagram` | Lays out 2–5 nodes and up to 12 directed connectors in one undoable operation. |
| `board_update_object` | Changes text, color, width or position by object id. |
| `board_delete_object` / `board_clear` | Removes selected content as undoable edits. |
| `board_undo` / `board_redo` | Moves between bounded document revisions. |
| `board_open` | Opens a user-selected `.pixelboard`; replacement is confirmed. |
| `board_save` | Saves an editable `.pixelboard`; overwrite is confirmed and read back. |
| `board_export` | Saves SVG through the same destination/overwrite confirmation and reads it back. |

Editing is medium risk: available in Hybrid and Agent, blocked in Guide because
it changes the Board. Open/save/export require approval and native file
selection. Emergency stop is checked in the existing dispatcher and blocks
subsequent tool calls. The service applies one diagram creation atomically and
it is undone in one step.

Every successful mutation returns revision and object count from the actual
service snapshot. Save/export results include the selected destination, byte
count and read-back verification. A thrown validation, stale revision,
conflicting document or file operation returns a failure; the model cannot
claim completion from an empty tool response.

## Diagram layout

The logical scene is 1000 × 650. `board_create_diagram` accepts semantic node
labels and edges by node index, then lays out connected boxes, arrows and
labels. `board_add_text` wraps text and makes a bounded character-width
estimate to select a separate baseline; it rejects overlap with existing
objects. This is not full font measurement or a general graph-layout engine.

## Desktop annotations are separate

Pixel Board is the editable, saved document. Desktop guidance is a temporary
passive layer over another app. `screen_draw_arrow` locates one unique UIA
control in a selected, revalidated window and uses that control's observed
rectangle; `screen_highlight_control` supports rectangle, circle and arrow
guidance. Both use the existing guidance window and are click-through. They do
not perform mouse/keyboard input.

There is no freehand desktop editor, interactive overlay toolbar, arbitrary
screen-coordinate drawing, desktop undo/redo, transfer from overlay to Board,
overlay Save/PNG/PDF, screenshot import, or PDF export in this checkpoint.

## Permission model

Board reads are low risk. Board edits are medium risk and local to Pixel's Board
document. File open/save/export are approval-gated because they read or write a
user-selected file. The screen-observation session grant is a separate,
volatile capability scoped to one exact live window (opaque reference, PID,
process name and title) and only to observation/passive guidance. It expires
within eight hours, does not survive restart, and does not grant UIA invoke,
typing, pointer input or app switching.

## Evidence and acceptance

`tests/pixel-board-service.test.ts` covers persistence, old draft import,
revision conflict, atomic diagram undo/redo, overwrite safety and write failure.
`tests/board-agent-tools.test.ts` confirms that the model schema contains
`board_create_diagram` and runs an actual `AgentExecutor` tool call through
`ToolExecutors` into `PixelBoardService`. `tests/agent-screen-session-grants.test.ts`
checks exact-window reuse, target mismatch, revocation and passive arrow
bounds.

These automated checks do not prove a real DeepSeek conversation or Electron
window. Windows acceptance must confirm agent-created objects render in
Workspace, are manually editable, undo as a group, save through the native
dialog, reopen, and display a passive arrow over a harmless selected window.
No actual app GUI or Windows file-dialog test is claimed for the current local
worktree.
