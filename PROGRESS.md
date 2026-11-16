# Pixel progress

Updated: 2026-11-16. Version: 0.2.1.

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
- The Windows C# UI Automation helper is compiled and connected as an approved, bounded surface: foreground window/title reads, semantic element search, exact unique `InvokePattern` activation, and matching exact present/absent postcondition checks. Actions fail closed if the expected postcondition already held before activation or UIA enumeration is incomplete. Raw coordinate actions are not available through it.
- Cursor presentation follows the pointer with the existing spring/edge geometry while the orb is collapsed; it is independent of Guide/Agent/Hybrid mode and pauses while the companion is expanded.
- The task strip shows verified steps distinctly and can display the persisted final response after restart.

## Validation for this tree

Checkpoint run on 2026-11-16:

- `npm run typecheck`: passed for renderer and main TypeScript projects.
- `npm test`: **651 passed, 0 failed, 0 skipped across 25 files**. All 22 Chromium browser tests and all 9 NSIS tests ran. Chromium needed package-local installation; the complete run needed loopback access for its local browser fixture.
- `npm run build` and `npm run build:native`: passed. `PixelNative.exe` compiled with the Windows .NET Framework compiler.
- `npm run pack`: passed after excluding Playwright's local test-browser cache. The unpacked package contains `Pixel.exe` and `resources/native/PixelNative.exe` and does not ship the test cache.
- `npm run dist`: passed with `--publish never`; it produced the NSIS installer, portable executable and unpacked ZIP.
- `npm run dev`: Vite started; Electron exited before main-process logs or a window appeared (`2147483651`, signed `-2147483645`). Renderer/preload initialization and visible app behavior remain unverified.
- The harmless UIA fixture and AgentExecutor harness are prepared. The fixture did not enter the foreground desktop session here, so the harness stopped before invoking any control. Actual Pixel approval cards and a real UIA postcondition remain unverified.
- Voice availability is probed at runtime. Test output varied by execution context, so no fixed STT/TTS availability is claimed.
- Windows CI is configured but was not run from this uncommitted tree. It uploads logs, JUnit results and distributions and does not publish releases.

See [the release-readiness report](docs/validation/PIXEL_RELEASE_READINESS.md), [the current-state report](docs/research/PIXEL_CURRENT_STATE.md) and [Windows acceptance procedure](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md) for exact evidence and laptop-side steps.

## Capability status

### Implemented

- Durable tasks and safe restart recovery; scoped, one-use approvals; cancellation; task outcomes and verification evidence.
- Bounded native UIA title/search/invoke/present-absent postcondition operations, with timeout/cancel termination and input-lease retention while process exit is unconfirmed.
- Browser, files, documents, project memory, reviewed skills, local routines and optional cursor-follow presentation.
- Windows CI for typechecking, browser/NSIS tests, native-helper compilation and non-publishing package builds.

### Partially implemented

- General action verification is limited to operations with implemented read-back or postconditions; UIA only checks exact accessible-control presence/absence.
- Voice depends on local Windows capabilities; microphone/UI behavior is unverified.
- Skills are model-mediated without deterministic interaction recording/replay. Specialist-agent coordination is not independently model-backed in the user task flow.

### Unverified

- Electron GUI, renderer/preload runtime, floating orb, expanded conversation, task/approval UI, cursor-follow, and the live Pixel UIA approval/action flow.
- Launch of unpacked and portable packages; clean install, upgrade, uninstall and user-data preservation.
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
