# Pixel companions

Updated: 2026-11-19. Source of truth: `PixMascot.tsx`,
`useCompanionAnimation.ts`, `CursorBuddy.tsx`, and `main/window.ts`.

## Pix — the application mascot

Pix lives in Pixel's UI. The canonical `PixMascot` SVG has a silver rounded
square body, dark facial screen, folded mint upper-right corner, mint eyes,
small arms and feet. It is distinct from the official P brand mark. Placements
reuse the same geometry: Workspace conversation header (34 px), welcome/empty
conversation (108 px), static assistant message avatar (22 px), compact Island
identity (21 px), and expanded Island response (21 px). Settings provides an
expression selector preview.
Historical chat avatars do not run idle animation.

The current assistant state maps to the mascot expression as follows:

| Pixel state | Pix expression |
| --- | --- |
| idle / unrecognized default | Idle, relaxed eyes and optional blink |
| listening | Listening, open attentive eyes |
| transcribing, thinking, responding | Thinking, upward/focused eyes and small dots |
| executing, working, pointing | Working, focused eyes |
| speaking | Speaking, gently animated mouth |
| success | Success, happy eyes and one short bounce |
| waiting for approval, error, paused | Concerned |
| stopped | Stopped, calm closed eyes |

The idle blink scheduler uses a bounded deterministic interval sequence with
an occasional double blink. It runs one timeout at a time, pauses while the
document is hidden, and cleans up on state changes/unmount. `Reduce Motion`
and `prefers-reduced-motion` suppress animation. State-driven CSS movement is
small, and does not synthesize assistant events. The speaking mouth indicates
playback state only; there is no phoneme-level sync. Compact Island Pix replaces
the assistant P identity while Pixel's separate P brand lockup remains. The
main-process voice service broadcasts real TTS playback transitions to all
active app renderers. Workspace, Settings and Island subscribe through a narrow
typed preload API; each renderer also queries current playback state on mount,
while newer events take precedence over a stale initial query. The Island also
receives live voice-capture/model/permission/task signals, including a short
terminal task result. The active transcript response uses that current
expression; historic transcript avatars remain still. Windows screenshot, animation cadence, CPU/GPU
and 140/96/64/40/32 px small-size review remain acceptance work.

## Cursor Buddy — the separate desktop follower

Cursor Buddy is pointer-shaped artwork in a separate transparent Electron
window. It is never Pix and does not use the Pix mascot. It remains
focusless/click-through under the existing native window policy and follows
the bounded cursor-follow placement algorithm. Settings preview is artwork
only; the native follower is hidden while Settings is open. Closing Settings
repositions it from the current pointer before showing. Workspace focus and
Island expanded/idle state are no longer hidden lifecycle gates.

The main process logs enabled/created/load/ready/visible/hide transitions and
native errors without persisting pointer coordinates. The renderer sends a
typed ready acknowledgement. A bounded timeout produces a diagnostic rather
than an indefinite hidden loading window. Its visible behavior, focus, click
through, monitor edges and lock/resume lifecycle still require the target
Windows acceptance procedure.

## Acceptance separation

Verify both systems independently. Pix should react to real Pixel states in
the Workspace and expanded Island but never move with the mouse. Cursor Buddy
should stay adjacent to the pointer but never display the Pix body. A Settings
preview does not prove the native Cursor Buddy window is active.
