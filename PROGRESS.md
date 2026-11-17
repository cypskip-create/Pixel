# Pixel progress

Updated: 2026-11-17. Version: 0.2.1.

## Current local validation — frosted glass, Workspace and supplied P mark

Current branch: `codex/ui-experience-2`. Current local HEAD: `01213c233372dddd68a2e794b65f19bfbc717abc` (unchanged; worktree is uncommitted for the user to commit).

- Reused the supplied reference's block P, cyan/aqua/white palette and sparkle cutout as the canonical mark in `src/shared/pixelMark.json`. The renderer, composer, assistant responses, Settings, Workspace, native tray and generated Windows app icon consume this same mark. The icon was generated and visually inspected.
- Implemented the separate frosted-glass Pixel Workspace, including shared conversation state, history, projects, tasks/activity, skills/routines, memory, tools, approvals and Settings. Its native window state is persisted and clamped; it shares the main-process agent and emergency stop.
- `npm run typecheck`: passed.
- `npm run build`: passed; main, bundled preload, Vite renderer, `build/icon.png` and editable `build/pixel-mark.svg` were generated.
- `npm run build:native`: passed; `PixelNative.exe` compiled and its protocol ping smoke passed.
- `npm run ensure:electron-runtime`: passed earlier in this run; verified Electron `45.2.3` against the lockfile.
- Full Vitest run: **718 passed, 0 failed, 26 skipped across 36 passed files and 1 skipped file (744 tests total)**. Skips: 17 Playwright browser cases (Chromium executable unavailable), 7 NSIS cases (`makensis` unavailable), and 2 opt-in native foreground integration cases. JUnit: `artifacts/test-results/vitest-junit.xml`; console log: `artifacts/full-tests-final.log`.
- Playwright Chromium installation was attempted, but download failed because DNS could not resolve `cdn.playwright.dev` (`ENOTFOUND`).
- Isolated unpacked packaging ran `electron-builder 26.18.0` through native dependency installation and into Windows packaging, then failed resolving `github.com` (`ENOTFOUND`). No packaged application was produced or validated; existing release artifacts were not targeted. Log: `artifacts/package-final.log`.
- `npm run test:preload-sandbox` remains unverified in this execution environment: Electron `45.2.3` exited `2147483651` (`0x80000003`) before the smoke app's main-entry marker. The log is `artifacts/windows-acceptance/preload-sandbox-smoke.log`.
- Actual interactive Windows GUI, Workspace multiwindow synchronization, native backdrop/blur, monitor/DPI behavior, packaged startup and installer flows remain **unverified** here. The prior packaged GPU/renderer child-process issue also remains a separate unresolved diagnosis; the development `--disable-gpu` switch stays diagnostic-only and is not applied to production.
- `git diff --check`: passed before the final documentation update; rerun after docs are reconciled.

See `docs/validation/PIXEL_RELEASE_READINESS.md` for the release gate and `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md` for exact target-laptop steps. Historical checkpoint counts below are retained as history and do not describe the current full-suite result.

## UI Experience 2.0 — Checkpoint 1

Branch: `codex/ui-experience-2` (branched from `0be3ba45b5b94a2018969670490a8c9b6ad8e80b`).

- Removed the duplicate mode picker. `InputBar` is now its only mount point.
- Mode choices now have menu-radio semantics, keyboard arrow/Home/End navigation,
  Escape dismissal, focus return and outside dismissal both within Pixel and
  when the native window loses focus.
- Added one measured panel-layout path from renderer `ResizeObserver` through a
  typed preload method to a main-process bounds clamp. The native window grows
  to the visible stack, keeps its horizontal center, and stays inside the
  active work area; renderer scrolling handles content taller than that area.
- The layout reports are coalesced and ignore tiny changes to limit native
  resizes during streamed responses. The width is bounded at 520 logical pixels.
- Added geometry and menu interaction tests. Unit tests cannot verify real
  Electron clipping, mixed-DPI layout or multi-monitor behavior; those remain
  laptop acceptance checks.

Validation for this checkpoint is recorded below after the full suite/build.
Do not infer completion of pinned-bar or separate-cursor work from this
checkpoint; those are subsequent checkpoints.

### Checkpoint 1 validation

- `npm run typecheck`: passed.
- `npm test -- --reporter=dot`: **669 passed, 0 failed, 26 skipped across 30 files (695 total)**. The Playwright browser is not installed in this runner and NSIS is unavailable; the opt-in native foreground integration checks also remain skipped.
- `npm run build`: passed (main TypeScript, bundled sandbox preload, and Vite renderer).
- `git diff --check`: passed.
- The test suite used a temporary `USERPROFILE` inside the writable project because existing tests create fixture directories under `os.homedir()`; this avoids the runner's protected user-profile path.
- Native Electron screenshots at the requested display sizes/scales are not available from this rebuilt branch yet. The visible Pixel window found during inspection belongs to a separate checkout (`C:\dev\Pixel`) and was left untouched. Native clipping, DPI, and multi-monitor checks remain unverified.
- A branch-local Electron launch using the separate Vite port 5200 and `--disable-gpu` exited with code 0 before creating a targetable window or startup log. No GUI behavior is claimed from that attempt; the existing single-instance Pixel process belongs to `C:\dev\Pixel`.

## UI Experience 2.0 — Checkpoint 2

- Replaced the primary window's remembered X/Y behavior with a persistent selected-display anchor. The bar is centered in that display's work area, starts 12 logical pixels from its top by default, and stays centered through measured expansion and collapse. Its top offset can be adjusted from 10 to 14 px.
- Legacy coordinates now only identify the old display once; startup clears the obsolete position and persists the selected display id. Missing displays fall back to the primary display. Display topology changes reapply the anchor.
- Removed the renderer's arbitrary window position IPC methods and the orb drag hook. The native main bar is not movable.
- Added an independent 64×64 transparent cursor BrowserWindow. It is non-focusable, non-movable, click-through, sandboxed, always-on-top at the ordinary floating level, and rendered as a small orb. It uses the existing spring/edge-clamp logic at 30 Hz while the main bar is idle. It freezes during active UI/approval surfaces and closes when disabled.
- Settings now reports the pinned top bar, selects a display, adjusts top offset, independently toggles the cursor companion, and controls its speed, offset and reduced motion. A legacy cursor presentation preference migrates to the new toggle only if no explicit value exists.
- Added tests for anchor geometry, monitor fallback, legacy preference migration, display selection and independent cursor enablement. Geometry and unit tests do not prove native window lifecycle, click-through or mixed-DPI rendering.
- The target-laptop GUI acceptance sequence is in `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`; no native visual pass is claimed for this checkpoint in this execution environment.

Checkpoint 2 validation and its local commit identity are recorded below after
the full suite and production build.

### Checkpoint 2 validation

- `npm run typecheck`: passed.
- Focused presentation tests: **142 passed across 5 files**.
- `npm test -- --reporter=dot`: **675 passed, 0 failed, 26 skipped across 31 files (701 tests total)**. Browser tests were skipped because Playwright Chromium is not installed; NSIS tests were skipped because `makensis` is unavailable; the opt-in native foreground integration suite remains skipped.
- `npm run build`: passed (main TypeScript, sandbox preload bundle and Vite renderer).
- `git diff --check`: passed.
- Native Windows click-through, multi-monitor/DPI and restart acceptance: unverified; follow the checkpoint-specific procedure in the Windows acceptance document.

## UI Experience 2.0 — checkpoints 3–5 and integration

The remaining UI Experience 2.0 work is implemented in the current local tree.
It remains uncommitted so the user can commit the complete task after review.

- The duplicate mode selector was removed. One presentation-layout path measures the visible stack and resizes the native window within the selected display work area. This addresses the original clipping defect: renderer z-index cannot draw beyond BrowserWindow bounds.
- The main bar is pinned to the selected display's top-center anchor. Arbitrary remembered main-window X/Y updates were removed; cursor following now belongs to a separate passive window and cannot reposition the bar.
- Persistent chat lifecycle is connected through HistoryStore, main-owned IPC and Recent Chats. New/open/continue/rename/delete/clear/search are supported; context is retrieved in main, filtered to sanitized user-facing messages, and bounded before provider use. Persistence obeys `privacy.persistHistory`; session-only operation is used when persistence is disabled or disk writes fail. Retention is capped at 50 conversations and 200 messages each.
- Explicit search phrases open a search URL for the configured Google, Bing or DuckDuckGo provider in the operating-system default browser. URLs are built in the main process with fixed HTTPS hosts and encoded query parameters. The renderer receives only a narrow search command; model-proposed searches use the existing permission policy. Pixel reports a successful launch, not read or verified results.
- Response reasoning remains separate and collapsed. Speech status appears only after playback succeeds. Screenshot and image-attachment labels now describe the actual supported actions. Terminal task cards dismiss without deleting task evidence. Settings uses a compact window/panel height.
- Main risks remain native UI layout, restart persistence and OS browser behavior, which need target-Windows acceptance. The isolated package attempt failed on restricted DNS before producing an unpacked artifact.

### Current validation

- `npm run typecheck`: passed.
- Focused changed-area suite: **69 passed across 8 files**.
- Full suite: **712 passed, 0 failed, 26 skipped across 36 files (738 tests total)**. Skips are for unavailable Playwright Chromium/NSIS prerequisites and the opt-in native foreground integration.
- A later repeat was stopped before Vitest returned a result; no result was inferred from that interrupted run. The totals above are from the latest completed full-suite run.
- `npm run build`: passed (main TypeScript, bundled preload, Vite renderer).
- `git diff --check`: passed after the documentation edits.
- Isolated unpacked packaging with `release/ui-experience-2-validation` as the destination failed before output because electron-builder could not resolve `github.com` (`ENOTFOUND`). Existing `release` artifacts were left untouched.
- `npm run test:preload-sandbox`: **blocked before the smoke app starts**. Electron 45.2.3 exited with `2147483651` (`0x80000003`); the captured log contains no `[preload-smoke] Electron main entry loaded` marker and no report JSON was written. The harness now removes stale reports and records launcher details/logs so a future run cannot mistake an old report for a pass. This runner failure does not exercise the preload assertions.
- Windows GUI acceptance was not completed. The Computer Use attempt stopped before application selection; no Windows UI behavior is claimed as passed.
- CI investigation: the remote `main` HEAD is `0be3ba45b5b94a2018969670490a8c9b6ad8e80b`. The GitHub connector returned no status checks for it and no workflow run for the current unpushed local branch, so the reported preload-smoke job failure had no accessible Actions log. The local workflow and smoke harness were inspected; the sandbox/security assertions remain enabled. This runner's matching pre-main Electron exit points to a runtime/runner launch failure before the smoke app or preload executes, but the remote job's root cause cannot be established without its Actions log. Reproduce with `npm run test:preload-sandbox` on the laptop or next GitHub run.
- Current local `HEAD`: `f10084e6f11129e4c453ba546ed09e50e6b9d8de`. The user will create the commit; no commit or push was performed.

## Current implementation

The existing Electron + React + TypeScript product is retained. The local changes extend its modular main process and settings UI.

- Tasks use runtime-validated Zod contracts and SQLite snapshots plus append-only task events.
- Restart recovery converts interrupted work to Paused, records the last safe checkpoint and never replays an action or pending approval automatically.
- Task controls include pause at safe model/tool boundaries, resume, cancel and emergency-stop propagation.
- Task records include sanitized request/result, project scope, bounded budgets, approval references, evidence and pending verification.
- Model tool arguments are validated against registered contracts before policy evaluation.
- Approval responses are correlated to their request id. The main process downgrades an unsupported request for a standing approval to one use.
- Browser-origin, app and document-directory scopes are retained. High-risk operations remain one-shot.
- State-changing work without evidence remains blocked for verification. File, memory, document and selected browser operations provide read-back or postcondition evidence.
- Cancellation is carried through tools, Python worker, voice processes, browser shutdown, native helper process and supervised child-process cleanup where supported.
- A shared main-process desktop input lease serializes `type_text` and native UIA invocation. Text entry checks the exact approved foreground title immediately before sending keys.
- Human handoff pauses a durable task, drops desktop ownership, requires an explicit Continue action and blocks further mutations until a fresh observation succeeds.
- Memory can be inspected, corrected, deleted and exported by project. Skills have strict versioned definitions, draft review, activation, integrity checks and run records; local daily routines persist idempotency, skip missed times, stop on failure and support a user-confirmed one-time retry.
- The Windows C# UI Automation helper is compiled and connected as an approved, bounded surface: foreground window/title reads, semantic element search in the foreground or an explicitly selected window, exact unique `InvokePattern` activation, and matching exact present/absent postcondition checks. Actions fail closed if the expected postcondition already held before activation or UIA enumeration is incomplete. Raw coordinate actions are not available through it.
- A metadata-only foreground observer starts before Pixel creates its windows. It uses Windows foreground/window events, with a 250 ms metadata polling fallback if the event hook or message loop fails; it excludes Pixel's main process and retains the last external foreground window in memory. It reports opaque session window references, process identity, title, bounds, minimized state and observation time; raw HWNDs stay internal. Current external windows can be listed for explicit user selection. Closed/reused/stale targets are rejected, and actions never switch applications. No background screenshots or observer history are persisted; the active task keeps volatile window identity only in memory for exact postcondition matching.
- UIA search, invocation and verification carry the selected opaque window reference plus exact title/process identity. Typing also resolves the selected target and rechecks HWND/PID/title/process identity immediately before input. Verification evidence is associated with the same window identity as the approved action.
- The optional cursor companion uses a separate passive window and existing spring/edge geometry; it never repositions the pinned top bar and pauses while the bar is active.
- Recent Chats is connected to main-owned conversation history and bounded model context. Sanitized user-facing transcripts are saved through HistoryStore only when persistence is enabled, with session-only fallback otherwise. The panel supports transcript search, create, restore, rename and confirmed deletion.
- Explicit web-search requests use a bounded query, configured fixed provider URL and main-process `shell.openExternal` call. Model-proposed searches remain permission-gated. Opening a results page is not recorded as reading the results.
- Response, task and Settings feedback now reflects actual completion/playback state, and control labels match the screenshot and image-upload behavior.
- The task strip shows verified steps distinctly and can display the persisted final response after restart.
- Settings now manages the DeepSeek API key through existing encrypted main-process IPC: masked draft input with optional reveal, save/change, confirmed removal, configured status and a user-triggered connection test with backend-category feedback. The stored key is never returned to the renderer or written to AppSettings, localStorage, task history or logs.

## Prior checkpoint validation (branch base)

Context-aware Windows foreground tracking checkpoint:

- `npm run typecheck`: passed (renderer and main TypeScript projects).
- `npm test -- --reporter=dot`: **680 passed, 0 failed, 2 skipped across 28 files (682 tests total)**. The skipped file is the opt-in Windows foreground integration suite; it is run separately against a real desktop.
- `npm run build`: passed (main TypeScript output, esbuild preload bundle and Vite production renderer).
- `npm run build:native`: passed; `PixelNative.exe` compiled and its JSON protocol ping smoke test succeeded.
- `npm run test:native-foreground`: **not passed**. Both opt-in checks stopped at `The observed window or process is no longer available.` The helper could not obtain a trustworthy foreground HWND from this execution environment, even after a Notepad window was focused and the Windows Forms fixture process was started. These are failed environment integration attempts, not passing target-window checks; run the documented sequence in an interactive laptop session.
- `npm run pack`: **not completed**. electron-builder reached packaging, then failed fetching a required artifact from `github.com` with `getaddrinfo ENOTFOUND`. No unpacked executable from this run was validated.
- `npm run dev`: **not completed**. Vite's strict port 5199 reported `Port 5199 is already in use`; a follow-up socket check found no persistent listener. The concurrent Electron process exited with code `2147483651` before it produced a Pixel window. The user reports Pixel launches on the target laptop, but this run did not reproduce it.
- The tracking path reads process/window metadata only and does not call screen capture. `scripts/test-native-foreground-manual.mjs` and the procedures in `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md` cover Notepad, VS Code, browser, multiple Pixel windows and stale-target handling. Pixel's actual permission-card interaction and the app-level focus sequence remain unverified here.
- The user reports that the separate sandbox preload smoke passed on the target laptop; it was not rerun as part of this tracking checkpoint. The DeepSeek Settings and conversation acceptance are outside this change.
- Voice availability is probed at runtime and varies by machine and execution context; no fixed STT/TTS availability is claimed.
- Windows CI is configured but was not run from this local tree. It runs the sandbox preload IPC smoke alongside type checks, the full suite, native compilation and non-publishing package builds; logs, smoke/JUnit results and packages are uploaded and no release is published.

The earlier packaged GPU/renderer child-process failure remains a separate unverified issue. Existing diagnostics record Chromium/Crashpad startup failures before a window appears; those results do not identify the preload as the cause and the preload repair is not evidence of GPU recovery. Keep `--disable-gpu` as a development diagnostic while the packaged GPU path is tested on the target laptop.

See [the release-readiness report](docs/validation/PIXEL_RELEASE_READINESS.md), [the current-state report](docs/research/PIXEL_CURRENT_STATE.md) and [Windows acceptance procedure](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md) for exact evidence and laptop-side steps.

## Capability status

### Implemented

- Durable tasks and safe restart recovery; scoped, one-use approvals; cancellation; task outcomes and verification evidence.
- Bounded native UIA title/search/invoke/present-absent postcondition operations, with timeout/cancel termination and input-lease retention while process exit is unconfirmed.
- Metadata-only Windows foreground tracking with in-memory last external window, explicit target listing, opaque window refs, same-process/window postcondition binding and stale-target rejection.
- Browser, files, documents, project memory, reviewed skills, local routines and optional cursor-follow presentation.
- Windows CI for typechecking, browser/NSIS tests, native-helper compilation and non-publishing package builds.

### Partially implemented

- General action verification is limited to operations with implemented read-back or postconditions; UIA only checks exact accessible-control presence/absence.
- Voice depends on local Windows capabilities; microphone/UI behavior is unverified.
- Skills are model-mediated without deterministic interaction recording/replay. Specialist-agent coordination is not independently model-backed in the user task flow.

### Unverified

- Actual Notepad → Pixel, VS Code → Pixel and browser → Pixel context sequences; multiple Pixel-window exclusion; permission denial/cancellation; close/stale detection; and live approved UIA action/verification. The opt-in integration run could not read a trustworthy foreground HWND from this runner.
- Runtime launch of the unpacked and portable packages; clean install, upgrade, uninstall and user-data preservation. This packaging attempt stopped on a blocked electron-builder download before an unpacked app was produced.
- The user's reported `window.cyps`/`window.cypsShell` sandbox smoke was not repeated here; Settings key persistence and DeepSeek conversation are outside this checkpoint. The user reports Pixel starts on the target laptop.
- Floating orb, task/approval UI, cursor-follow and the live Pixel UIA workflow remain unverified in this run because this desktop launch did not produce a targetable Pixel window.
- The GitHub Actions workflow itself; it becomes runnable after the user pushes this branch.

### Missing

- General credential broker, deterministic UI interaction recorder/replay, independent model-backed delegation, VirtualBox/SSH and Pixel Code.
- Automatic continuation of an interrupted task. Recovery pauses and asks for review; it does not replay the old call stack.

## Research and architecture

- [Pixel current state](docs/research/PIXEL_CURRENT_STATE.md)
- [Grok Bot behavior matrix](docs/research/GROK_BOT_FEATURE_MATRIX.md)
- [Original Clicky mapping](docs/research/CLICKY_TO_PIXEL_MAPPING.md)
- [Agent runtime](docs/architecture/PIXEL_AGENT_RUNTIME.md)
- [Security model](docs/architecture/PIXEL_SECURITY_MODEL.md)
- [Skills and routines](docs/architecture/PIXEL_SKILLS_AND_ROUTINES.md)
- [Windows acceptance](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md)
- [Handoff](WAVE_HANDOFF.md)
