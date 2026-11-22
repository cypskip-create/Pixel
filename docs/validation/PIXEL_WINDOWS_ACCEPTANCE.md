# Pixel Windows acceptance procedure

## Core Completion 6.2 — current local verification boundary

Committed base reviewed: `64e0383484cfcbc35370c9f8aa2498f9428dd15d`. Windows
workflow [44869374637](https://github.com/cypskip-create/Pixel/actions/runs/44869374637)
passed on that exact commit, including unpacked, portable and NSIS packaging.
The current file, browser-tab and productivity changes are local and are not
covered by that run. No release, install, upgrade or uninstall was performed
for the local changes.

Latest local verification on 2026-11-21: typecheck passed; Vitest **893 passed,
28 skipped, 0 failed (921 total; 64 files passed, 1 skipped)**; production
build passed; native helper compilation passed; Python worker tests **12/12
passed**. Skips are Chromium-dependent browser tests, local NSIS tests
(`makensis` absent), and opt-in foreground integration tests. The local
sandboxed preload test rebuilt the bundled preload but Electron exited
`2147483651` (`0x80000003`) before its report. The hosted run's preload smoke
passed on the committed base SHA; local bridge behavior remains unverified.
The dev launch also found port 5199 occupied and no branch-local Electron
window. The visible Pixel windows belonged to a separate `C:\dev\Pixel`
checkout and were not modified.

`npm run pack` rebuilt the renderer and native helper, then failed in
`scripts/build-voice-worker.ps1` with “No suitable Python runtime found.” The
required Python 3.12 x64 is not installed here; no unpacked app, portable
executable or NSIS installer was generated for the current local changes.

The local Notes & Planning page now supports note creation/editing and Markdown
import/export through native file dialogs. Automated checks cover renderer
routing; complete this acceptance on a disposable project after building the
current local tree. The latest green GitHub run is not evidence for these edits.

### File search/open/Recycle Bin acceptance

Use only disposable fixtures inside a temporary folder under the current user
profile. The local unit tests use injected adapters and do not prove the OS UI.

1. Create a PDF fixture and a text fixture with known sizes and modified dates.
2. Ask Pixel to search the folder with a size bound and an ISO modified-time
   bound; compare the returned file paths/metadata to the fixture values.
3. Ask Pixel to open the PDF and folder, approve each exact path, and verify the
   expected default application/Explorer window appears. Pixel currently only
   reports the OS open request and path existence.
4. Ask Pixel to move a disposable text fixture to the Recycle Bin, approve it,
   verify its original path is absent, then restore it manually through the
   Windows Recycle Bin and verify its contents.
5. Confirm executable/script files, symlinks, and paths outside the user home
   are refused without invoking the OS adapter.

### Clipboard tool laptop acceptance

After the user pushes the local changes and the resulting Windows Actions run
passes, use that run's artifact or build the same checkout. With harmless test
text only:

1. In Agent mode ask Pixel to read the clipboard. Approve once. Verify the
   response can use the text, then restart Pixel and confirm the response is
   not in persistent chat history or task result history.
2. Ask Pixel to copy a harmless sentence. Approve once. Paste it manually into
   Notepad and confirm it matches. Ask Pixel to restore the previous clipboard
   and confirm restoration works only if the clipboard has not changed since
   Pixel copied.
3. Change the clipboard manually, then attempt the restore token. Confirm Pixel
   leaves the new clipboard untouched.
4. Put a disposable non-secret text value on the clipboard and ask Pixel to
   place it in a uniquely named Notepad edit control. Approve once. Confirm the
   text appears and the UIA read-back verifies it. This tool replaces the
   control's value; it does not perform caret-position Ctrl+V.
5. Confirm credential-like samples are refused without exposing their value in
   approval cards, audit summaries, task args or durable task results. Verify
   Emergency Stop cancels queued tool work and clears in-memory restore
   snapshots.

Do not use real credentials to test pattern refusal. Pattern matching is not a
secret detector and may not recognize every sensitive string. The current
clipboard implementation handles plain text only.

### Installed-app procedure after a new hosted build

1. Run `npm ci`, `npx playwright install chromium`, `npm run typecheck`,
   `npm test -- --reporter=dot`, `npm run test:voice-worker`,
   `npm run build:native`, `npm run build`, `npm run test:preload-sandbox`,
   `npm run build:voice-worker`, `npm run pack`, and `npm run dist` in the
   exact pushed checkout. Preserve the console output.
2. Install the generated NSIS installer normally. Verify Pixel starts and the
   preload bridge, Settings return navigation and clipboard approval flow work.
3. Upgrade the existing installation while preserving user data; verify
   conversations, settings, projects, encrypted API key, task history and
   downloaded voice models remain present. Do not inspect or print key/model
   contents.
4. Uninstall Pixel and confirm the user-data directory remains intact. Reinstall
   and verify the same profile can be reopened.
5. Record the pushed commit SHA, workflow URL, installer file hash, OS build,
   display scale, test totals and observed failures. Do not call an installer
   step passed unless it was actually run interactively.

## Experience 5.2 — Board agent and workspace follow-up

The current local change is based on latest GitHub `main`
`d98fbe896c4893fadc506b7fd0783e570dfbd3f8`. CI run
[`44567448710`](https://github.com/cypskip-create/Pixel/actions/runs/44567448710)
is green on parent commit `0a8f39f68bf54bc10ac3274521ef348b8289080a`; it does
not validate this local worktree. Typecheck, full tests and production build
must be rerun on this exact source before merging. The Electron GUI and these
steps have not yet been exercised here.

### Pixel Board agent workflow

1. Start Pixel from the target checkout with `npm run dev`. Open the full
   Workspace and choose Pixel Board from the navigation rail.
2. In Agent mode, ask: “Create a new board called Network Architecture.”
   Confirm the title appears in the Board page and the task records a successful
   `board_create` result.
3. Ask: “Draw a diagram showing a PC connected to a switch, then a router, then
   the internet.” Confirm Pixel reports a verified diagram tool result; the
   Workspace opens the Board page; a title, four editable node boxes, and three
   arrows appear. Select and move one object, then undo it once. Confirm the
   entire generated diagram is undone/redone as one group.
4. Ask Pixel to “Add a short explanation under the diagram.” Confirm the text
   wraps and does not overlap the existing object bounds. Edit the text
   manually, then confirm the agent can still read the new content with
   `board_get_state`.
5. Ask Pixel to save the Board. In the native Save dialog choose a temporary
   test folder and `.pixelboard` name. Confirm the overwrite prompt appears if
   a destination already exists, and confirm Pixel reports a path only after
   read-back verification. Open the saved file independently as JSON and
   verify it contains the title and objects.
6. Create a blank board, then ask Pixel to open the saved document. Confirm the
   replacement warning appears and the original saved objects return. Export
   the reopened Board to SVG and verify the file begins with an SVG element.
7. Deny one Board edit approval (open/save is approval-gated) and confirm the
   requested file action did not happen. Trigger Emergency Stop during a
   harmless task and verify later agent tool calls are rejected.

### Selected-window annotation and permission reuse

1. Open Notepad with harmless text and keep it as the only candidate target.
   Ask Pixel to identify the current foreground window and the Search/Settings
   control on the chosen harmless target.
2. Ask Pixel to inspect that explicitly selected window and draw a passive
   arrow to one uniquely identified accessible control. If prompted, approve
   “This Window · Session” and read the scope: the exact window only, passive
   observation/guidance, no clicking or typing.
3. Confirm the arrow appears on the external desktop window, not in Pixel
   Board. Verify it points at the selected control, remains click-through, and
   the control was not clicked or focused by Pixel.
4. Ask Pixel to inspect/draw on the same window again; the session authorization
   should be reused without another prompt. Change to a different window and
   repeat; the new target must not inherit the previous window grant.
5. Revoke the session grant from Settings → Permissions, then retry and confirm
   a new approval is required. Deny it and verify the overlay does not appear.

This release supports UIA-bound temporary guidance only. It does not include an
interactive freehand desktop canvas, arbitrary coordinate drawing, desktop
annotation editing/save/export, or physical-coordinate clicking. Do not treat
the arrow as an executed computer action.

### Workspace and Cursor Buddy visuals

Compare Pixel at 1280×768 or 1366×768 and 100%/125% scaling against the supplied
Codex references. Confirm the narrow section rail, separate chat sidebar,
selected conversation, near-black chat canvas, blue right-aligned user
bubbles, unboxed assistant replies and fixed charcoal composer. Open Settings:
the chat sidebar should be replaced by the Settings categories; check grouped
rows, blue enabled switches and right-aligned controls. Capture screenshots
before/after for review; automated CSS assertions are not visual acceptance.

Enable Cursor Companion. Confirm the terminal prints `renderer-ready` then
`visible`, inspect the small rounded-rectangle character beside the pointer on
both light and dark backgrounds, and verify it remains click-through and
focusless. Test all corners, a second display, Workspace, Settings,
Reduce Motion, disable/re-enable, screen lock and resume. Pix should remain the
silver/mint application mascot and must not follow the pointer.

### Local commands

Run in the current checkout before the GUI procedure:

```powershell
npm run typecheck
npm test -- --reporter=dot
npm run build
git diff --check
```

The full Windows CI run for the pushed commit is required after this local
change; the successful parent-commit run above is not a substitute.

## Experience 5.1 base and Cursor Buddy trust follow-up (2026-11-19)

Current automated evidence and blockers are in
[`PIXEL_EXPERIENCE_POLISH_5_READINESS.md`](PIXEL_EXPERIENCE_POLISH_5_READINESS.md).
The merged Experience 5.1 base passed typechecking, production build,
native-helper build and Vitest (**839 passed, 27 skipped; 866 total**). Python
worker tests passed **12/12**. The sandboxed Electron smoke failed with
`0x80000003` before a report; the Python 3.12 frozen worker could not be built
because no suitable interpreter is installed. Settings/Workspace screenshots,
the packaged application, installer and new Actions run remain unverified.

The current local Cursor Buddy fix adds a narrow IPC path for renderer-ready
and a reduced-motion-only preference. Focused policy tests pass **6/6** and the
updated full suite passes **842, skips 27, fails 0 (869 total)**. Its production
build and TypeScript checks pass. The sandbox preload smoke rebuilt the bridge
but Electron exited `0x80000003` before renderer startup. The actual cursor
window has not been tested after this fix.

### Cursor Buddy laptop acceptance

On the same checkout that contains the fix, run `npm run build`, then enable
Cursor Companion in Settings. Confirm the terminal reports `renderer-ready`
followed by `visible` within eight seconds, with no untrusted-renderer errors.
Toggle Reduce Motion and confirm it updates the companion. Verify Cursor Buddy
stays adjacent to the pointer, remains click-through, does not take focus, and
stays visible across Island, Workspace and Settings transitions. Its only
permitted IPC calls are the readiness acknowledgement and reduced-motion read;
all other calls from the cursor window must remain rejected.

Only one Codex Settings reference screenshot and the approved Pix concept were
available in the current attachment set. Compare Settings to the supplied
image at 100%, 125% and 150% Windows scaling where available. The selected
interactive accent should be blue while the charcoal panels and Pix's mint
artwork remain separate. Do not treat a DOM render as Windows visual
acceptance.

### Current-tree commands

Run on the target Windows laptop after committing/pushing the user's changes:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test -- --reporter=dot
npm run test:voice-worker
npm run build:native
npm run build
npm run test:preload-sandbox
npm run build:voice-worker
npm run pack
npm run dist
```

The test run skips browser tests if Chromium was not installed and NSIS tests
if `makensis` is not available. Do not count skips as passes. Preserve the
terminal output and the CI run URL; `pack`/`dist` must not publish a release.

### Settings, Pix and Dynamic Island

1. Launch the current checkout (not another Pixel installation) and capture
   Settings General and Appearance at 100%, 125% and 150% where available.
2. Confirm the content stays charcoal, selected mode/radio and ON controls are
   blue, OFF controls remain neutral, focus is visible, and labels/helper text
   are readable. Visit every implemented Settings category and use keyboard
   navigation.
3. Capture the Workspace header, empty conversation, assistant response,
   compact Island and expanded transcript. Confirm Pix occupies the compact
   Island assistant slot, the P remains in Pixel's brand lockup, historical
   transcript avatars do not animate, and the active transcript Pix follows
   recording/thinking/execution/speaking/outcome state.
4. Test `Reduce motion`, hidden/background pause, one-shot task success/error,
   approval waiting and emergency stop. Confirm the Island does not resize or
   shift when Pix changes expression. Cursor Buddy must remain pointer-shaped
   and separate.

### Pixel Board in Workspace

The current Pixel Board is an in-Workspace editable SVG scene, not a desktop
annotation overlay. Its local draft and explicit exports can be checked now;
cross-app marks, PDF, screenshot insertion, native save dialogs and window
coordinate alignment are not implemented.

1. Open Library → Pixel Board; add pen/highlighter strokes, line, arrow,
   rectangle, circle, text and step marker.
2. Select and move an object; delete it; test eraser, undo and redo.
3. Reload Workspace and confirm the local draft is restored. Export `.pixelboard`,
   SVG and PNG. Reimport the `.pixelboard` document and verify object edits and
   geometry remain available.
4. Use reduced motion and emergency stop while the board is open; verify the
   board does not capture input outside its Workspace surface.

### Scope/security acceptance still required

The current tree intentionally preserves existing per-tool approval policy.
The requested risk-tier policy, Agent screen-observation session grant,
interactive desktop drawing and coordinate-based mouse action have not been
implemented, so the corresponding acceptance steps below are not applicable
as passing claims. Do not test these by using an existing session grant as if
it covered an unrelated target. Run the existing screen guidance/UIA flows and
confirm their permissions, target identity, postcondition, cancellation and
emergency stop remain intact.

Keep `npm run dev`'s `--disable-gpu` as a development diagnostic. Compare
`npm run dev:gpu` and packaged GPU startup separately; do not attribute either
result to the voice-worker change.

## Historical acceptance records

## Tools 4.2 acceptance status — 2026-11-19

This section supersedes earlier generic UIA-control acceptance text below for
the current uncommitted Tools 4.2 implementation. Initial real desktop fixture
runs found the target and verified ValuePattern read-back but failed in
InvokePattern/TogglePattern. Repeated later runs passed the scripted
InvokePattern, separate completion-label verification, TogglePattern
state read-back, and durable completed-task reload. The latest report is
`artifacts/windows-acceptance/pixel-native-uia-e2e-2026-11-19T12-11-25-948Z.json`;
both direct and documented npm fixture commands exited zero after bounded
cleanup confirmed helper and fixture termination. Pixel's actual Electron
approval-card interaction was not tested. See
the tracked result at
[`PIXEL_TOOLS_4_2_UIA_FIXTURE_RESULT.md`](PIXEL_TOOLS_4_2_UIA_FIXTURE_RESULT.md).

The latest GitHub Windows Actions run reviewed for the Tools 4.2 brief is
[`44498305105`](https://github.com/cypskip-create/Pixel/actions/runs/44498305105).
Typecheck, voice-worker unit tests, sandboxed preload smoke, full tests and
native-helper compilation passed. Packaging failed in the pre-existing Voice
4.1 packaged-worker smoke: the frozen worker returned `BAD_JSON` with “Expecting
value: line 1 column 1” and then reported stdin closed. This is separate from
Tools 4.2. The PowerShell worker build script now writes the smoke request as
explicit UTF-8 bytes, but rebuilding the packaged Python 3.12 worker and rerun
of the workflow are still required to verify the repair. No workflow run exists
for these unpushed local changes.

### Required final automated checks

From a fresh PowerShell session at the repository root, run:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run build:native
npm run test:voice-worker
```

Keep each command's complete output. Chromium-dependent tests need Playwright
Chromium installed; NSIS integration requires `makensis`. Any test reported as
skipped remains unverified. The native UIA harness passed both directly and
through the npm build-and-test wrapper, which exited zero after bounded cleanup.

### Memory

1. Open Settings → Privacy and confirm **Automatic Memory** is enabled. Turn it
   off, send “I prefer the black-and-charcoal interface,” and verify no automatic
   memory appears. Turn it back on and send the preference again.
2. Open project Memory and confirm one concise preference exists with
   automatically saved provenance. Open a new chat in the same project and ask
   “What theme do I prefer?” Confirm the answer comes from this project only.
3. Repeat the preference in different wording; verify no duplicate appears.
   Correct it directly, open History, and verify the previous value remains in
   revision history. Use the supported forget command and confirm only the
   active project's matching preference is removed.
4. Verify project switching does not retrieve this preference in another
   project. Export the active project, inspect the JSON, and delete the test
   memory from Pixel.

### Persistent permissions

1. Ask Pixel to open Notepad and select **Always Allow**. Confirm the app opens
   and Settings → Permissions lists the exact Notepad grant and target.
2. Ask again and verify the same scoped launch does not prompt. Restart Pixel,
   repeat, then revoke that grant and confirm approval is requested again.
3. Select **Allow Once** for a bounded action and repeat it; a new approval must
   appear. Select **Deny** and confirm that action does not execute.
4. Try an unsupported/high-risk action. **Always Allow** must remain disabled
   with a reason; no permanent grant should appear. Use Emergency Stop and
   confirm saved grants are revoked and pending approval is cancelled.

### UI Automation and task recovery

Build and run the current harmless fixture harness:

```powershell
npm run test:native-uia-fixture
```

Earlier runs failed at TogglePattern and InvokePattern. The latest npm report
shows both actions and the postcondition verified and the command exited zero.
Continue requiring generated JSON showing `valuePatternVerified`,
`togglePatternVerified`, `postconditionVerified`, a completed durable task and
verification evidence.

Then use the actual Pixel UI with the disposable fixture. Verify exact-window
selection, unique control discovery, the three approval decisions, denial and
cancellation. Confirm the expected UIA state before Pixel reports success.
Change the target window between observation and approval and verify Pixel
refuses the stale target without activating another app. Close Pixel while an
approval is pending, restart it, and verify recovery requires re-observation.
Trigger Emergency Stop during a multi-step fixture task and confirm no later
step executes. Keep screenshots unused for these metadata/UIA checks.

No test screenshots for the new permission cards are available because the
Electron GUI acceptance could not be completed in this environment. The
separate native UIA fixture has passed; do not claim that automatic memory,
Always Allow restart persistence, visible approval flows or emergency-stop
recovery passed until they are observed through the Pixel UI on the target
laptop.

---

This is the manual gate for behavior that type checks and automated tests cannot prove. The user reports that Pixel now starts on the target Windows laptop and its sandbox preload smoke test passes. This procedure includes the focused foreground-context integration. Record only behavior observed directly on the tested machine; see [PIXEL_RELEASE_READINESS.md](PIXEL_RELEASE_READINESS.md) for local build and test evidence.

## Tools 4.1 — exact capture and visual guidance (2026-11-19)

### Current evidence

The source implementation and unit coverage are present, but this checkpoint is
not release-verified. `npm run typecheck` passed; the focused screen,
agent-tool and overlay tests passed **31/31**; the full suite passed **782**,
failed **0**, and skipped **27** (**809 total; 48 files passed, 1 skipped**).
The skips are 17 browser cases (Playwright Chromium absent), 7 NSIS checks
(`makensis` absent) and 3 opt-in native foreground integration checks.
`npm run build` and `npm run build:native` passed.

The native integration was run with Notepad focused on a newly created blank
fixture and failed **3/3** with `The observed window or process is no longer
available.` This means exact native capture, UI Automation discovery and the
actual overlay are **not verified** here. Do not interpret the TypeScript,
unit tests or native compilation as evidence that the end-to-end flow works.
Electron development GUI startup and packaged GPU behavior also remain
unverified in this host.

### Target-laptop commands

Run in a PowerShell window at the repository root. Keep the harmless test app
visible and focused for the native integration check.

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test -- --reporter=dot --testTimeout=15000
npm run build
npm run build:native
npm run test:native-foreground -- --reporter=dot
```

The native integration should pass all three checks: real foreground metadata,
exact identity resolution and a PNG captured from that exact foreground
window. If it reports `The observed window or process is no longer available`,
save the complete output and stop; do not treat later UIA or overlay behavior
as verified. Do not paste screenshots or window titles containing private
information into logs.

For a development launch, first check whether the required Vite port is already
in use. If it is occupied, identify the owner and close only a stale Pixel
development process; do not terminate an unrelated listener. Use two
PowerShell windows:

```powershell
# Terminal 1
npm run dev:renderer -- --host 127.0.0.1 --port 5199 --strictPort
```

```powershell
# Terminal 2
npm run dev:electron
```

Do not change sandbox, context isolation, node integration or web security
settings to make the test pass. Keep `--disable-gpu` as the normal development
diagnostic; investigate `npm run dev:gpu` separately and keep packaged GPU
child-process failures separate from capture behavior.

### Capture-to-highlight acceptance

1. Open a new harmless Notepad document and keep Notepad foreground. Ask Pixel
   which application is active. Confirm the title/process identity matches
   Notepad. Approve the explicit screen-observation request when prompted.
2. Ask Pixel to find one uniquely named accessible menu or control. Confirm
   the response identifies UI Automation as its source and reports an exact
   name/AutomationId, role, bounds and observation time. If the control is
   absent, ambiguous or unavailable, confirm Pixel asks for a more specific
   target instead of guessing coordinates.
3. Ask Pixel to highlight that exact control with a short label. Confirm the
   white/light-grey rectangle, circle or arrow is aligned with the real control
   and the charcoal label is readable. Verify Pixel says it did not click.
   Click the control manually and confirm the overlay does not block clicks,
   scrolling or typing.
4. Move and resize Notepad. Confirm the highlight follows the revalidated UIA
   bounds. Switch to another application, close Notepad, lock the session and
   trigger emergency stop in separate runs. Confirm the overlay hides or
   clears, and never appears over the unrelated foreground app.
5. Repeat with Windows Settings using one uniquely accessible control. Do not
   change system settings; use navigation-only inspection. Confirm a stale or
   ambiguous target fails closed.
6. On multiple monitors, record each display's bounds and scaling. Inspect a
   negative-coordinate display and a region clipped at the right/bottom edge.
   Confirm metadata gives the intended display, actual image dimensions and
   scale; a cross-monitor region must return an actionable failure.
7. Keep an annotation visible while streaming a long harmless conversation.
   Confirm the Island does not steal focus or flicker, the Workspace remains
   conversation-first and the underlying app remains clickable.
8. Confirm capture is request-driven: no periodic/background screenshots are
   produced. Confirm no image or annotation is written to chat/task history by
   default, and ordinary read-only inspection does not authorize clicking or
   typing.

Save command output and a small set of redacted screenshots in the designated
validation artifact directory. Record a pass/fail/unverified result per step,
Windows build, display layout/scaling, current commit and artifact paths. Only
mark a GUI item passed after observing it on that actual Windows desktop.

## Latest checkpoint: monochrome theme and cursor companion (2026-11-18)

The renderer now uses a shared grayscale palette and the optional cursor
character targets 28 DIP inside a 36 DIP click-through window. Geometry, theme
tokens, settings migration and visibility rules have automated coverage. This
Codex desktop could not create a Pixel window: after compiling `PixelNative.exe`,
the Electron development child exited with `2147483651` (`0x80000003`) before
Pixel startup logging or a target window. Therefore every visual, motion,
focus/click-through and real-window lifecycle item below is **unverified** in
this environment. Do not infer success from screenshots of another checkout.

Automated evidence for this local tree: `npm run typecheck` passed; the full
suite completed with **789 passed, 0 failed, 2 skipped (791 total; 46 files
passed, 1 skipped)**; the NSIS preflight was **9/9 passed**; `npm run build`
and `npm run build:native` passed. The two full-suite skips are opt-in real
desktop foreground integration cases. `npm run test:preload-sandbox` did not
reach its renderer: Electron 45.2.3 exited with `2147483651` (`0x80000003`).
This host failure prevents visual acceptance; it does not count as a pass.

### Monochrome appearance

1. Run the `npm run dev` build on the target laptop. Capture the idle Island,
expanded conversation, streaming response, finished response, Recent Chats,
mode menu, recording waveform, Settings and Workspace.
2. Repeat the floating captures over a white webpage, a dark webpage and the
   desktop. Confirm opaque black/charcoal fills, neutral borders, no Acrylic,
   Mica, blur or decorative gradients, and no distracting desktop content
   bleeding through the Island.
3. Confirm the black/charcoal hierarchy is consistent across sidebar,
   navigation, messages, composer, menus, Settings, task status, approvals,
   errors, success states and emergency stop. Check keyboard focus and text
   contrast in dark and configured light modes.
4. Compare the in-app monochrome P against the approved source geometry and
   negative-space sparkle. Confirm its grayscale treatment does not change the
   master asset used by native icons.

### Cursor companion size, tracking and lifecycle

1. Enable **Show cursor companion**. Confirm the artwork is 28 DIP in a 36 DIP
   native window, appears close to the real pointer and does not compete with
   it. Record the desktop DPI/scaling and monitor arrangement.
2. Move the pointer slowly and quickly, stop abruptly, jump across the display,
   move to all four corners and cross left/above monitors with negative virtual
   coordinates. Verify it remains within the current work area, flips sides
   without edge chatter, stays within the bounded gap, settles near the target
   and does not progressively trail. Repeat at 100%, 125% and 150% scaling.
3. While another app is focused, click through the character onto harmless
   underlying controls. Confirm Pixel does not take focus or intercept clicks.
   Verify no screenshots are captured by cursor tracking.
4. Expand Pixel, show a permission card, open Settings and Workspace, hide the
   Island, lock/suspend and resume. Confirm the character hides in each
   suppressed state and reappears snapped to the current pointer only after
   returning to compact idle. Disable it and confirm the window and timer stop.
5. Verify Dynamic Island position, hover/click/leave, streaming geometry,
   Recent Chats, conversation history, DeepSeek, browser search, Workspace,
   approvals, PTT waveform and emergency stop are unchanged.

Save screenshots for the surfaces/backgrounds and a short cursor-motion capture
where possible. A still screenshot cannot prove tracking distance or click
through. Record pass/fail/unverified per item; automated tests do not replace
this desktop evidence.

The dev command retains `--disable-gpu` as a diagnostic. If startup works, test
`npm run dev:gpu` separately and preserve both logs. The packaged GPU/renderer
child-process failure is a separate diagnosis; do not attribute it to this
theme or assume this change fixed it.

## Previous checkpoint: Interaction Engine 3.0 (2026-11-18)

The implementation is present and automated checks cover the presentation
reducer, fixed geometry, stream scrolling, shortcut dispatch, watcher release,
cancellation, timeout and helper-crash recovery. **This Codex environment did
not verify the visible app, microphone, speech recognition, or a real PTT
conversation.** Do not mark those passed from the automated results.

### Dynamic Island and streaming

1. Launch the current checkout with `npm run dev`. Confirm the 138×38 visible
   pill is centered at the selected display's top work-area edge. Test at 100%,
   125% and 150% scale, on each display, with the taskbar on each edge where
   practical.
2. Hover for 140 ms, move between the pill and panel, and leave/re-enter within
   the 950 ms grace period. Confirm hover does not focus the text field or steal
   focus from the app underneath. Click the pill and confirm the editor can
   receive focus. Leave it idle for 4.5 seconds; a non-empty draft must remain
   available and a pending approval must stay visible.
3. Request a long harmless explanation while another app has focus. Confirm
   the Island stays compact during generation. Open it intentionally and check
   that the bounded response scroll follows the tail until you scroll up, then
   preserves your reading position. Confirm the top-center position does not
   change for individual tokens and the app does not flash or steal focus.
4. Repeat after cold launch. Open Workspace, verify the original geometric
   character follows listening/thinking/working/approval states, and confirm
   Recent Chats, mode controls, permissions and emergency stop still work.

### Push-to-talk and microphone

1. In Settings → Voice, review the PTT accelerator and microphone input. Check
   that Windows reports a local speech recognizer or that a faster-whisper
   package and selected model are installed in the offline cache. Pixel does not
   fetch a model automatically. If the local capability is unavailable, stop
   here and record voice as unavailable for that Windows account.
2. Focus Notepad or a browser, hold the configured default `Ctrl+Shift+Space`,
   and say: “Pixel, tell me the current time.” Confirm only an audio capture
   starts, the small waveform animates in the compact pill, no screenshot is
   taken, the app beneath remains focused, and neither chat nor Workspace opens.
3. Release the shortcut. Confirm the microphone indicator stops, one local
   transcript is submitted exactly once, Pixel responds, and the conversation
   is saved. Check the transcript is accurate; a tool returning without error
   is not evidence of transcription. Repeat with a longer harmless instruction.
4. In manual microphone mode, dictate a sentence and stop. Confirm the text is
   added to the composer and is not submitted automatically. Cancel a capture,
   deny microphone permission, unplug the chosen input and test the 20-second
   safety limit; each should produce a clear failure and stop the mic. Confirm
   emergency stop, screen lock, suspend and restart recover without leaving a
   recorder active or duplicating a submission.
5. Recheck the active app focus, Island size, cursor companion, chat history and
   emergency stop after both success and failure cases.

### Current packaged build

Use a unique output folder so an existing release directory is preserved:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run test:preload-sandbox
npm run build
npm run build:native
npx electron-builder --win --dir --publish never --config.directories.output=artifacts/interaction-engine-3-validation
```

Launch `artifacts\interaction-engine-3-validation\win-unpacked\Pixel.exe`
on the target desktop. Confirm the transparent rounded Island and bundled
sandbox preload load; then repeat Settings, chat history, harmless DeepSeek,
permission and emergency-stop checks. Keep the `artifacts` folder, command
logs, test report, screenshot set, OS build and display/DPI notes with the
acceptance result. `npm run dist` is a separate NSIS/portable build and must not
be claimed complete unless it exits successfully. Installer, upgrade,
uninstall and data-preservation checks remain separate release gates.

The automated test suite on 2026-11-18 passed with Chromium installed and local
fixture access enabled; the exact totals and the Electron host failure are in
the current Interaction Engine entry in `PROGRESS.md`.

## Automated checks before opening Pixel

Run from the repository root in a normal Windows PowerShell session:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run test:preload-sandbox
npm run build
npm run build:native
```

`test:preload-sandbox` launches a hidden Electron window with `sandbox`,
`contextIsolation`, `nodeIntegration: false` and `webSecurity` enabled. It checks
`window.cyps` and `window.cypsShell`, Settings IPC, task and permission events,
permission responses, shell events, and the absence of raw Node/IPC globals. It
uses harmless stub IPC handlers and a test-only API-key placeholder. It writes
`artifacts\windows-acceptance\preload-sandbox-smoke.json` and
`preload-sandbox-smoke.log` on success. A failure before the Electron app starts
is an environment failure, not a pass.

## Previous checkpoint: restored dark floating UI

Use the rebuilt app on the target laptop and record a screenshot for each
background. Close Pixel normally before launching a different build so the
single-instance lock does not redirect the launch to an older process.

1. From the repository root, build and start the development app:

   ```powershell
   npm run build
   npm run dev
   ```

2. Observe Pixel over a white webpage, a dark webpage, then the desktop with
   other windows minimized. Save a screenshot at each state.
3. Confirm opaque black/charcoal panels are present, no grey frosted surfaces
   or blur remain, desktop text does not show through distractingly, and the
   approved monochrome P mark, rounded shape, compact alignment and button
   contrast are intact.
4. Click another application to confirm it receives focus and input normally.
   Check the Island's menus, Recent Chats, Settings and approval controls. Open
   Workspace and confirm its layout, projects, tools, memory and task activity
   still work. Restore a saved conversation and send a harmless DeepSeek prompt.
5. Confirm the Island stays at its selected top-center display position and no
   flicker or stray rectangular backdrop appears during startup or expansion.
6. Stop the `npm run dev` process with `Ctrl+C`, confirm it exited, and repeat
   the visual/runtime check with the normal GPU path:

   ```powershell
   npm run dev:gpu
   ```

The main and Workspace windows explicitly select the Windows system backdrop
`none`, and the renderer contains no CSS `backdrop-filter`. Do not add Acrylic,
Mica or any blur material during this check. The standard `npm run dev` keeps
its existing `--disable-gpu` diagnostic; `npm run dev:gpu` omits that switch.
Do not add `--no-sandbox` or loosen the BrowserWindow security flags.

Capture a reproducible local evidence bundle from the repository root:

```powershell
$artifactDir = Join-Path $PWD 'artifacts\windows-acceptance'
New-Item -ItemType Directory -Force $artifactDir | Out-Null
git rev-parse HEAD | Set-Content (Join-Path $artifactDir 'commit.txt')
npm ci 2>&1 | Tee-Object (Join-Path $artifactDir 'npm-ci.log')
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npx playwright install chromium 2>&1 | Tee-Object (Join-Path $artifactDir 'playwright-install.log')
if ($LASTEXITCODE -ne 0) { throw 'Playwright install failed' }
npm run typecheck 2>&1 | Tee-Object (Join-Path $artifactDir 'typecheck.log')
if ($LASTEXITCODE -ne 0) { throw 'Type check failed' }
npm test -- --reporter=default --reporter=junit --outputFile.junit="$artifactDir/vitest-junit.xml" 2>&1 | Tee-Object (Join-Path $artifactDir 'tests.log')
if ($LASTEXITCODE -ne 0) { throw 'Test suite failed' }
npm run test:preload-sandbox 2>&1 | Tee-Object (Join-Path $artifactDir 'preload-sandbox.log')
if ($LASTEXITCODE -ne 0) { throw 'Electron sandbox preload smoke test failed' }
npm run build 2>&1 | Tee-Object (Join-Path $artifactDir 'build.log')
if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }
npm run build:native 2>&1 | Tee-Object (Join-Path $artifactDir 'native-build.log')
if ($LASTEXITCODE -ne 0) { throw 'Native helper build failed' }
```

Then capture the GUI and package checks with these commands. Stop `npm run dev` with Ctrl+C after observing the app; this expected stop is not a test failure.

```powershell
npm run dev 2>&1 | Tee-Object (Join-Path $artifactDir 'dev.log')
npm run pack 2>&1 | Tee-Object (Join-Path $artifactDir 'pack.log')
if ($LASTEXITCODE -ne 0) { throw 'Unpacked package build failed' }
npm run dist 2>&1 | Tee-Object (Join-Path $artifactDir 'dist.log')
if ($LASTEXITCODE -ne 0) { throw 'Windows distribution build failed' }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-windows.ps1 -Launch 2>&1 | Tee-Object (Join-Path $artifactDir 'windows-validation.log')
if ($LASTEXITCODE -ne 0) { throw 'Windows validation failed' }
```

Keep the generated JUnit XML, `release` distributions and `validation-report-*.json` with the logs.

Build and inspect the unpacked app and installer with the pinned electron-builder 26 setup:

```powershell
npm run pack
npm run dist
```

`npm run pack` builds the unpacked Windows app. `npm run dist` builds the NSIS installer, portable executable and ZIP; both commands explicitly disable publishing. Save command output and the test report under an acceptance artifact folder. GitHub Actions uploads CI logs, JUnit test results and build artifacts from the Windows job.

If the build host sets `ELECTRON_RUN_AS_NODE`, remove it in that shell before testing Electron. Do not change system security settings to work around a launch failure.

## Launch and shell checks

1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-windows.ps1 -Launch`.
2. Start the development build with `npm start` or launch `release/win-unpacked/Pixel.exe` after packaging. In this Codex environment, do not treat an Electron exit before window creation as an application pass; use a normal interactive desktop.
3. Verify the floating orb, tray menu, global shortcut, settings, expand/collapse, emergency stop, focus behavior and restart persistence. Confirm the main bar cannot be dragged away from its anchor.
4. Repeat on every attached display, including 125%/150% scaling, negative-coordinate monitor layouts, unplug/replug and taskbar positions.
5. Record the generated `validation-report-*.json`, OS build, display topology and DPI. A missing window, bad bounds or lost tray entry is a failure, not an assumed pass.

## Pinned bar and cursor companion acceptance

1. Start Pixel. Confirm the main pill is centered on the selected display and its top edge is 10–14 logical pixels below the work-area top. Expand the bar, open the mode selector and show a response/task panel; verify the center and top edge remain fixed.
2. In Settings, select **Move to display** for every connected monitor. Confirm the bar moves to that display's work-area center. Restart Pixel and confirm the selected display is retained.
3. Move **Top offset** between 10 px and 14 px. Confirm the bar follows the value without changing its horizontal center.
4. Enable **Show cursor companion**. Confirm a 28 DIP character in a 36 DIP
   native window follows at the pointer's configured 8×8 DIP offset. Click
   through it onto a harmless control and confirm it does not take focus or
   intercept the click.
5. Move the pointer near every work-area edge and across mixed-DPI monitors,
   including monitors left of or above the primary display. Confirm stable
   flipping, bounded lag and correct placement within the current work area.
6. Expand the Island, show a permission card, open Settings and Workspace, and
   hide the Island. Confirm the character disappears instead of freezing at an
   old desktop point. Return to compact idle and verify it snaps near the
   current pointer before appearing.
7. Lock/suspend and resume, change reduced-motion settings, then disable the
   cursor companion. Confirm motion snaps when requested and its window/timer
   stop without moving the pinned bar.
8. Unplug the selected monitor. Confirm Pixel moves to the primary display and persists that fallback. Reconnect it, select it again and confirm restart behavior.

Do not use old drag-position or **Follow cursor** steps: those controls were
replaced by display anchoring and a separate passive cursor window. Automated
geometry and settings tests do not prove artwork size, tracking distance,
native click-through, visibility lifecycle or mixed-DPI behavior on a real
desktop.

The repository's previous environment report explains why a sandboxed Electron/Chromium process may fail before Pixel code runs: [Electron constraints](../ELECTRON-CONSTRAINTS.md). Treat that report as environment-specific; verify on the target laptop.

## Workspace and supplied P mark acceptance

Use the interactive Windows app after the development launch, then repeat the
relevant checks with the unpacked build:

1. Confirm the grayscale geometric P appears in the Island, toolbar lockup,
   composer, assistant response, Settings and Workspace. Compare the P geometry
   and central sparkle cutout with the approved master; the renderer must not
   reveal the cyan/aqua master colors. Tray and Windows app icons keep the
   approved source geometry and platform asset treatment.
2. Open **Pixel Workspace** from the island toolbar, the tray menu and the
   configured `CommandOrControl+Shift+P` shortcut. Confirm these open/focus the
   same Workspace window rather than creating duplicate assistant sessions.
3. Resize Workspace, move it, maximize it, restore it and restart Pixel.
   Confirm the last usable bounds and maximized state are restored on the
   correct display and remain on-screen after a display is disconnected.
4. Start a harmless conversation in the island and continue it in Workspace;
   then send a reply in Workspace and verify the island receives the same
   active conversation and response stream. Confirm saved conversation history
   is identical from both surfaces when history persistence is enabled.
5. Start one harmless task and confirm both surfaces show the same task state.
   Request an approval, approve or deny it from either surface, and confirm the
   result is reflected in both. Trigger emergency stop and confirm it applies
   to the one shared task and does not leave a second agent running.
6. Change a Settings value or API-key status and confirm the other open
   surfaces update without showing or exposing the secret. Confirm projects,
   tools, memory and skills/routines panels load their existing data.
7. Close Workspace with its native close control. Confirm the island and tray
   remain available; reopen Workspace and confirm the prior conversation is
   still active.

These checks require a real Electron desktop. Renderer screenshots or unit
tests alone do not prove multi-window synchronization, focus behavior, native
window restoration, tray rendering or Windows backdrop support.

## Separate packaged GPU diagnosis

The earlier packaged GPU/renderer child-process failure is separate from the
preload and Workspace changes. Test the normal packaged GPU path without adding
`--disable-gpu` to the launch command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\capture-startup.ps1 -Exe .\release\win-unpacked\Pixel.exe -Seconds 20 -Report .\artifacts\windows-acceptance\packaged-gpu-startup.txt
```

Record the process exit code, whether a top-level window appeared, `pixel-startup.log`,
Chromium/GPU child-process output, Windows version and GPU driver. Compare with
the development diagnostic launch only as a separate run; the dev script keeps
`--disable-gpu`, while production and packaged builds retain the normal GPU
path. Do not call the issue fixed based on the preload smoke or a successful
build. Preserve both logs if the packaged app fails before `ready-to-show`.

## Preload bridge acceptance

The compiled preload must be a single bundled file at
`dist\main\preload\index.js`. The build and pack steps verify that its local
runtime dependency graph is bundled and that the unpacked `app.asar` contains
the same preload. On the target laptop, also run `npm run test:preload-sandbox`
and require a JSON report with `"ok": true`. This uses a real Electron
sandboxed `BrowserWindow` and harmless stub IPC handlers; it does not modify app
settings or contact DeepSeek.

Then run `npm run dev` and inspect the Electron startup log and renderer console.
There must be no preload error or missing-native-bridge warning. In the renderer
console, run:

```javascript
({
  cyps: typeof window.cyps,
  settingsGet: typeof window.cyps?.settings?.get,
  tasks: typeof window.cyps?.tasks?.onUpdate,
  permissions: typeof window.cyps?.permissions?.respond,
  shell: typeof window.cypsShell?.voiceCapability,
  settings: await window.cyps?.settings?.get(),
  hasApiKey: await window.cyps?.settings?.hasApiKey(),
})
```

Expect `cyps` to be `"object"`, each listed method to be `"function"`, Settings
to return its configuration without a key value, and `hasApiKey` to be boolean.
Open Settings and confirm it loads. Under **Privacy → API key**, use **Add Key**
to save a disposable DeepSeek test key if no key is configured; do not replace
an existing key. Confirm the status changes to **Configured**, restart Pixel,
and confirm it remains configured without the key being shown. Select **Test
Connection** and confirm the result matches the provider response. Never paste
the key into DevTools, logs or task text. With a configured key, send the
harmless prompt `Reply exactly: PIXEL BRIDGE TEST OK` and verify the response
appears.
Check permission cards and the emergency stop with a harmless test task. Repeat
the preload/Settings smoke on `release\win-unpacked\Pixel.exe`; confirm the
startup log has no `preload-error` and the bridge methods are available there.
Keep `--disable-gpu` as a development diagnostic; this bridge check does not
verify packaged GPU behavior.

## Ordered first-release validation

Run these checks in order and record a pass only after observing the behavior or artifact directly:

1. **Electron development launch:** run `npm run dev` in an interactive PowerShell window. Save its output. Record whether Electron stays alive and emits a clean startup log.
2. **Main, renderer and preload:** inspect the startup log for main-process stages, renderer load and preload bridge readiness. Confirm no preload or renderer errors appear.
3. **Visible orb:** confirm the floating orb appears, stays on top and does not steal focus.
4. **Conversation UI:** expand the orb, send a harmless prompt and confirm the conversation surface renders and accepts input.
5. **Task strip and approval cards:** run a harmless action task; inspect its current step/status in the task strip and confirm the approval card names the action and scope before approving it.
6. **Cursor companion:** complete display selection, edge-clamp, passive click-through, active-surface pause, disable and restart checks above.
7. **Native-helper task:** run the harmless UIA fixture procedure below and inspect the task's persisted outcome and verification evidence.
8. **Unpacked app:** run `npm run pack`, launch `release\win-unpacked\Pixel.exe`, and repeat the orb, conversation, approval, cursor and UIA checks.
9. **Portable executable:** launch `release\Pixel-Portable-0.2.1.exe` and repeat the core checks. Confirm no install registration is created.
10. **Clean NSIS install:** install `release\Pixel-Setup-0.2.1.exe` into a clean test profile; confirm shortcuts, launch and use the app.
11. **Existing-install upgrade:** install over the previous Cyps identity and confirm the same install location is upgraded and settings, conversation history and encrypted credentials remain available.
12. **Uninstall and user data:** uninstall through Windows Apps/Programs. Confirm the app is removed and `%APPDATA%\Pixel` plus any retained `%APPDATA%\cyps` migration backup remain intact.

Record failed steps as failures and blocked steps as unverified. Do not infer GUI success from a zero exit code or package creation.

## Task-state acceptance

Use a disposable test folder and check the actual app:

1. Start a short safe task. Confirm the compact task strip shows its objective and current step.
2. Pause during model work and while an approval card is open. Confirm no new tool begins after pause; resume and confirm it continues once.
3. Cancel during a controllable operation. Confirm the task ends Cancelled and no later tool runs.
4. Approve a file creation in the test folder. Confirm the file is reopened and its content matches before Pixel reports it verified.
5. Ask for a harmless browser action and verify the page's expected text. Confirm the source URL is reported.
6. Deny an action and confirm the target does not change.
7. Close Pixel while a task is waiting for approval. Restart and confirm the task is paused with a recovery note, the approval did not survive and no action restarted.
8. Complete a state-changing operation with no available postcondition. Confirm Pixel reports that it needs verification rather than showing Completed.

Automated tests cover the SQLite store, interrupted-task recovery, safe-point pause/resume, cancellation, stale approval ids, argument validation, file read-back and worker termination. They do not replace these app-level checks.

## Native desktop and human-handoff checks

### Current disposable fixture recheck (2026-11-22)

The local `scripts/test-native-uia-e2e.mjs --launch-fixture` run launched the
disposable fixture and confirmed exact-window selection plus `ValuePattern`
text entry/read-back. The fixture's WinForms checkbox exposed `TogglePattern`,
but its provider threw `InvalidOperationException: Operation is not valid due
to the current state of the object` on `Toggle()`. Pixel recorded the failed
state-changing action and correctly refused the later invocation because the
action outcome still needed verification. The JSON diagnostic is under
`artifacts/windows-acceptance/` (git-ignored). This run is a failure for the
toggle scenario, not a pass; retry with a provider-compatible fixture or test
control, then separately exercise the approval UI in Pixel. The harness now
re-observes after typing and after the toggle attempt to respect observation
freshness.

Start the harmless, uniquely accessible Windows Forms fixture in a separate PowerShell window:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\start-uia-fixture.ps1
```

The fixture only changes its own label between `Pixel harmless action: pending` and `Pixel harmless action: completed`; **Reset fixture** restores the initial state. It does not access files, the network, credentials or other applications. Keep it in the foreground while running each task.

For a deterministic main-process integration check, build and run:

```powershell
npm run test:native-uia-e2e
```

This invokes the real helper and AgentExecutor against the fixture, has the test harness grant one-use approvals through Pixel's PermissionBroker, and writes a JSON result plus the durable SQLite task/event database under `artifacts\windows-acceptance\`. It does not display Pixel's approval cards. Complete the actual UI checks below separately before calling the desktop workflow accepted.

1. Ask Pixel to read the foreground title. Approve the read and confirm it reports `Pixel UIA Harmless Fixture`.
2. Ask Pixel to search for the unique button `Run harmless UIA action`. Approve the search and confirm the returned role/name and bounds match the fixture.
3. Ask Pixel to invoke that exact button with expected postcondition `Pixel harmless action: completed` present in the same window. Confirm the approval card shows the exact title, selector and postcondition. Confirm the completion text was absent before action. Approve the action once.
4. Approve the fresh UIA verification request. Confirm the action step becomes verified only after the completion text is observed, the task records its outcome/evidence, and the task strip reports completion.
5. Press **Reset fixture** and repeat with a different window focused after observation; the action must be refused and the fixture must remain pending.
6. Start a separate harmless task and cancel it while it is still running. Confirm its state becomes Cancelled and no later tool action occurs.
7. Start a task and close Pixel while it waits at an approval. Restart Pixel. Confirm the task is paused with a recovery note, the old approval is absent and the fixture remains unchanged.
8. Test a duplicated selector and an inaccessible/custom control. Ambiguous or unsupported controls must fail without acting.
9. Trigger human takeover for an authentication/verification step. Confirm Pixel releases its input lease, waits for explicit Continue, does not treat acknowledgement as proof, and observes before continuing.

These steps exercise the actual Pixel approval card and durable task UI. A direct helper call or unit test does not substitute for them.

## External foreground context acceptance

The foreground observer captures only window metadata (HWND stays inside the
native helper/main process); it does not take screenshots or persist an
observer history. The active task holds the opaque target identity in memory
only while matching an approved action to its postcondition. `get_foreground_window` continues to describe the
current foreground window. `get_last_external_foreground_window` reports the
last non-Pixel foreground window held in memory. The read tools still go
through Pixel's explicit permission flow. If multiple windows could match a
requested target, use `list_external_windows` and ask the user to select the
exact window before searching or acting. Pixel never switches applications on
its own.

On the target laptop, use a harmless Notepad document, a VS Code editor window
with no unsaved changes, and a browser tab without a form or sensitive content:

1. Start Pixel. Open Notepad, focus its document, then switch to Pixel's orb and
   open the conversation. Ask, “Which application was active immediately before
   Pixel?” Approve the metadata read and require the exact Notepad process/title.
2. Repeat with VS Code and the browser. Open Pixel Settings as a second Pixel
   window, focus each Pixel window in turn, and verify both remain excluded
   while the same external app is reported.
3. With an external app recorded as last active, close that app without
   focusing another external app first. Ask Pixel again. It must report the
   target as stale/closed and must not offer it as a valid action target.
4. Record an external app, minimize it, and inspect the returned metadata. It
   must show `isMinimized`; UIA search, verification and invocation must refuse
   to treat hidden controls as available. Restore the window and re-observe.
5. Start a read-only observation and deny its permission. Confirm no tool call
   runs. Start another and cancel it while approval is pending; confirm it does
   not execute afterward.
6. For a state-changing UIA check, select one exact window/control, approve the
   named action, and verify the expected postcondition in that same window
   identity. Change focus or close/reopen the target before approval and confirm
   Pixel refuses the stale target without switching applications.
7. Keep screenshots/capture permission unused during these checks. Confirm the
   app's capture log/event is absent; foreground tracking should continue using
   title, process, bounds and timestamps only.

For a helper-level interactive check, build first and run in a Windows Terminal
PowerShell tab while Pixel is open. The terminal PID is excluded because
returning to the prompt changes foreground context. The manual script verifies
metadata, configured Pixel/terminal process exclusion and stale detection; it
does not exercise Pixel's visible permission card:

```powershell
$repoPath = [regex]::Escape((Resolve-Path .).Path)
$pixel = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('Pixel.exe', 'electron.exe') -and
  $_.CommandLine -match $repoPath -and $_.CommandLine -notmatch '--type='
} | Select-Object -First 1
if (-not $pixel) { throw 'Could not identify the running Pixel main process.' }
$terminal = Get-Process WindowsTerminal -ErrorAction Stop | Select-Object -First 1
$env:PIXEL_HOST_PIDS = "$($pixel.ProcessId),$($terminal.Id)"
npm run build:native
npm run build:main
node scripts/test-native-foreground-manual.mjs notepad
node scripts/test-native-foreground-manual.mjs Code
node scripts/test-native-foreground-manual.mjs brave
```

Replace `brave` with the process name for the browser installed on the test laptop (for example, `msedge`, `chrome` or `firefox`) when needed.

For each run, focus the named application, switch to Pixel, then return to the
terminal. The helper should still identify the application because both Pixel
and Windows Terminal process IDs are excluded. When prompted, close the
target, return to the terminal and require `closed-target-marked-stale`. Save
terminal output with the other Windows acceptance artifacts. If using a
different terminal, replace its process ID in `PIXEL_HOST_PIDS` with the PID
that owns its visible top-level window.

## Security and voice checks

- Verify the API key is stored only in the encrypted credential file and cannot be read back through renderer APIs or logs.
- Test a credential-looking value in a task request, memory save and skill draft; confirm it is rejected/redacted and never appears in persisted task args.
- Inspect, correct, delete and export project memory. Confirm the export contains only the active project scope.
- Review and activate a harmless skill, run it once through the task gateway, then schedule a local daily routine. Verify run history, missed occurrence behavior, cancellation and failure pause. Confirm restart does not replay a run.
- Open a public site that redirects to localhost/private IP. Confirm Pixel refuses to expose the resulting page. The current guard checks after the connection; this does not prove the private connection never began.
- Check local voice capabilities using `node scripts/diagnose.mjs`. Test only the speech capabilities that the current Windows probe reports; the diagnostics result is machine-specific and does not prove microphone behavior in Pixel's UI.
- Confirm the companion does not record or transmit screenshots continuously.

## Distribution checks

On a test profile, validate unpacked launch, portable launch, clean install, upgrade over the previous Pixel identity, uninstall and user-data preservation. Do not use the account's only data copy. Preserve the existing appId, NSIS GUID and legacy `%APPDATA%\cyps` migration behavior. Attach `scripts/diagnose-installer.ps1` output and startup logs when a case fails. SmartScreen reputation and signing status must be reported as observed; never promise them from a build artifact.

## Conversation-first Workspace acceptance

Run on the Windows laptop from the checkout under test. Close only that
checkout's existing Pixel process before starting its dev build, so a
single-instance handoff cannot send the test to a different installation.
Do not use an already-open Pixel window from another checkout as evidence.

1. Run `npm run typecheck`, `npm test`, and `npm run build`. Record the commit
   SHA and the test totals from the output.
2. Run `npm run dev`. Confirm the main startup log reaches `startup complete`,
   the renderer and sandbox preload initialize, the floating Island appears,
   and **Workspace** opens without a preload/native-bridge error.
3. Confirm Workspace starts in a clean conversation with Recent Chats visible,
   Library collapsed, no task-details side panel, a compact mode trigger, and a
   one-line composer. Verify the emergency-stop control remains in the title
   bar.
4. At 1366×768 and 1920×1080, save a full Workspace screenshot to
   `artifacts/windows-acceptance/workspace-1366x768.png` and
   `artifacts/windows-acceptance/workspace-1920x1080.png`. If the monitor does
   not support a requested mode, resize the Workspace window to that logical
   size and record the actual display scale. Compare both images with the
   supplied reference: the conversation should occupy most of the window, the
   task panel should be absent by default, and no oversized mode selector or
   stacked frosted rectangles should appear.
5. Open and close Library; navigate to Projects, Tasks, Skills & Routines,
   Memory, Tools and Settings. Collapse and expand the sidebar and verify each
   destination remains reachable. Search recent chats, open one, start New
   Chat, and restore the earlier conversation.
6. Open the mode trigger. Confirm it shows only the current mode until clicked,
   then displays all three choices in a viewport-bounded menu. Test arrows,
   Home/End, Escape, outside click and focus return. Confirm a consequential
   mode change still displays the existing confirmation.
7. Type a long prompt. Verify the composer expands to its limit, then scrolls
   internally. Confirm Enter sends, Shift+Enter inserts a line, attachments and
   screenshot capture remain available, voice control responds, and Stop
   cancels generation.
8. Send one harmless Guide Mode conversation. Verify the response streams and
   that a long transcript does not jump while you are reading above the bottom.
   Use the header menu's Search the web flow and confirm it opens the configured
   provider only after the user submits a query.
9. Start a harmless task that requests approval. Confirm its action, target and
   scope are readable inline with Allow/Deny controls. Deny it, then verify no
   state change occurred. In a separate harmless task, approve once, confirm
   inline status, open Details, and inspect the real step and postcondition.
   Confirm that a pending verification is not labeled Completed. Cancel a
   running task and confirm the emergency stop is immediately available.
10. Close Workspace from its native close control. Confirm Pixel and the tray
    continue running. Reopen Workspace and confirm conversation/task state is
    synchronized. Repeat the same smoke against the unpacked app when available.

Attach the two PNGs, startup log and a short result table to the release
readiness report. Record Windows build, display scale, package type and pass/
fail for every step. DOM tests and a browser preview do not substitute for this
native Electron acceptance.

## UI Experience 2.0 — Checkpoint 1 panel-layout acceptance

Run these steps in an interactive Windows session after building the current
branch. The geometry unit tests are not a substitute for this visual check.

1. Start Pixel from the checked-out project with `npm run dev`; confirm there
   is one companion window and no renderer/preload error.
2. Expand the input and open the mode selector. Confirm exactly one selector
   appears, all three modes and descriptions are visible, and the panel is not
   clipped by the native window.
3. Use arrow keys and Home/End to move selection, then Escape. Confirm the menu
   closes and focus returns to the mode trigger. Reopen it and click elsewhere
   in Pixel; confirm it closes. Reopen it and switch focus to another app;
   confirm native focus loss closes it without refocusing Pixel.
4. Display a long response and open a running task or approval card alongside
   the other visible panels. Confirm they stack without overlap. If the stack
   exceeds available work-area height, confirm the Pixel panel scrolls and
   clicks outside the actual native bounds reach the underlying application.
5. Repeat at 1366×768 and the available 1920×1080/2560×1440 display sizes, at
   100%, 125% and 150% scaling, including a secondary monitor with negative
   coordinates where available. Record the monitor arrangement and scaling.
6. Save a screenshot of the expanded mode selector and the combined response/
   task or approval layout. Record any clipping, overlap, click interception,
   scrollbar placement or focus-return failures.

The 2026-11-17 branch run passed the geometry and DOM interaction tests, but
has not yet produced a screenshot from this rebuilt branch. Treat all listed
native visual/DPI/monitor steps as **unverified** until they are completed on
the laptop.

## UI Experience 2.0 — pinned bar, history and search acceptance

Run these checks after `npm run build` and `npm run build:native`, then repeat
the package checks against the unpacked Windows application. The automated
layout, renderer and history tests do not prove native Electron window
placement, Windows default-browser handling or restart persistence on the
target profile.

1. Start `npm run dev`. Confirm the primary bar appears centered 10–14 logical
   pixels below the selected display work-area top. Expand and collapse it,
   open Settings, Recent Chats and the mode selector, and change modes. Confirm
   the bar's horizontal center and top anchor stay fixed, the mode selector
   appears once, panels fit inside the native window, and long content scrolls
   inside Pixel.
2. In Settings, select another attached display and restart Pixel. Confirm the
   selected display is retained. Unplug that display and confirm Pixel falls
   back to the primary display without opening off-screen.
3. Enable the cursor companion. Move the pointer across the display and onto a
   second monitor if available. Confirm it follows independently, does not
   steal focus or intercept clicks, and pauses while the main bar is active.
   Disable it and confirm it disappears while the primary bar remains in the
   same anchored position.
4. With `privacy.persistHistory` enabled, create two conversations and send a
   harmless prompt to each. Confirm each conversation continues with its own
   context, the Recent Chats panel shows the right title and preview, search
   finds a term in the transcript, rename works, and confirmed delete removes
   only the selected conversation. Restart Pixel and restore each saved chat.
   Confirm no API key, reasoning trace, tool arguments or image payload appears
   in the user-facing transcript storage.
5. Disable `privacy.persistHistory`, create a conversation and send a harmless
   prompt. Confirm it is available in the current session but does not create
   or update a persisted history record. Re-enable persistence and verify new
   messages save normally.
6. Select Google, Bing and DuckDuckGo in Settings in turn. For an explicit
   request such as “Search the web for electric cars — Nairobi”, confirm the
   Windows default browser opens the configured provider with the complete,
   correctly encoded query. Repeat with Unicode and punctuation. Pixel should
   report that it opened the results page, without claiming that it read the
   results.
7. Ask an ordinary question such as “What is a search engine?” Confirm no
   browser opens. In Hybrid/Agent mode, ask the model to open a search and deny
   or cancel the permission; confirm no browser launch occurs. Confirm an
   allowed, approved search opens only the selected provider URL.
8. Check response scrolling and collapsed reasoning, speech feedback after
   actual playback, screenshot labeling/target, task completion/failure
   dismissal and the compact Settings layout. Confirm dismissal does not erase
   task history, and that the emergency stop still cancels active work.
9. Build and inspect the unpacked app before portable or installer validation.
   Confirm it shows the same pinned bar and loads Recent Chats, Settings and
   browser search. Then validate portable launch, clean install, upgrade,
   uninstall and user-data preservation on a disposable profile.

For a validation run that does not replace any existing files in `release`,
write the unpacked build to a new directory and retain the complete log:

```powershell
npx electron-builder --win --dir --publish never --config.directories.output=release/ui-experience-2-validation
```

Record the OS build, display arrangement/scaling, persistence setting, selected
search provider, default browser, exact commands, pass/fail/blocked result for
each item, and paths to screenshots/logs. Do not mark any GUI, installer or
restart check passed unless it was observed directly on that Windows profile.

### Previous checkpoint environment result (2026-11-17)

- `npm run typecheck`, `npm run build`, `npm run build:native` and the Electron
  runtime version check passed. The full suite passed **718 tests, 0 failed,
  26 skipped (744 total across 37 files)**. Skips: 17 browser cases due to
  unavailable Chromium, 7 NSIS cases due to missing `makensis`, and 2 opt-in
  foreground integration cases. The Chromium download failed DNS resolution
  for `cdn.playwright.dev`.
- The isolated package attempt reached Windows packaging, then failed because
  electron-builder could not resolve `github.com` (`ENOTFOUND`); no app output
  was produced. Existing `release` artifacts were preserved.
- The sandboxed Electron smoke exited `2147483651` (`0x80000003`) before the
  smoke app entry point, so it did not verify bridge calls in this run.
- Windows GUI, Workspace, backdrop, display behavior, packaged app, portable
  build and installer acceptance remain unverified. The packaged GPU issue is
  a separate, unresolved diagnosis; use the command in the section above.

### Local and laptop validation commands

Run these in the repository root on a network-connected Windows development
machine. The full installer command writes to the standard `release` folder;
use the isolated command above if existing artifacts must be preserved.

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run ensure:electron-runtime
npm run build
npm run build:native
npm run test:preload-sandbox
npm run dev
npm run pack
npm run dist
```

## Report template

```text
Windows version/build:
Pixel commit/tree state:
Package tested (source/unpacked/portable/installer):
Displays and scaling:
Commands and automated totals:
GUI steps passed/failed:
Artifacts/log paths:
```

## Electron launch recheck

The current source checkout built the main process, preload and native helper,
and the dev renderer started on a fallback port. Electron exited with
`2147483651` (`0x80000003`) before Pixel's boot log was created. A direct
`electron.exe --version` probe reproduced the same exit before version output,
using both this checkout's binary and the read-only binary under
`C:\dev\Pixel`; both had SHA-256
`15E815A2D04AED1A01787354B93CD2CAB425F339B3BEAEF4F9E4193647F5399B`. A
Computer Use launch timed out; the subsequent fresh app inventory contained no
Pixel window. Thus the app-level GUI acceptance could not begin. This evidence
locates the failure before Pixel's main entry point, but does not identify its
host-level cause. User app data was not changed for this recheck.
