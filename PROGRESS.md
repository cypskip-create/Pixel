# Pixel progress

Updated: 2026-11-17. Version: 0.2.1.

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
- Cursor presentation follows the pointer with the existing spring/edge geometry while the orb is collapsed; it is independent of Guide/Agent/Hybrid mode and pauses while the companion is expanded.
- The task strip shows verified steps distinctly and can display the persisted final response after restart.
- Settings now manages the DeepSeek API key through existing encrypted main-process IPC: masked draft input with optional reveal, save/change, confirmed removal, configured status and a user-triggered connection test with backend-category feedback. The stored key is never returned to the renderer or written to AppSettings, localStorage, task history or logs.

## Validation for this tree

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
