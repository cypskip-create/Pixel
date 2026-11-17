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
- The Windows C# UI Automation helper is compiled and connected as an approved, bounded surface: foreground window/title reads, semantic element search, exact unique `InvokePattern` activation, and matching exact present/absent postcondition checks. Actions fail closed if the expected postcondition already held before activation or UIA enumeration is incomplete. Raw coordinate actions are not available through it.
- Cursor presentation follows the pointer with the existing spring/edge geometry while the orb is collapsed; it is independent of Guide/Agent/Hybrid mode and pauses while the companion is expanded.
- The task strip shows verified steps distinctly and can display the persisted final response after restart.
- Settings now manages the DeepSeek API key through existing encrypted main-process IPC: masked draft input with optional reveal, save/change, confirmed removal, configured status and a user-triggered connection test with backend-category feedback. The stored key is never returned to the renderer or written to AppSettings, localStorage, task history or logs.

## Validation for this tree

Preload bridge and DeepSeek key-settings checkpoint run on 2026-11-17:

- `npm run typecheck`: passed for renderer and main TypeScript projects after the key-settings changes.
- `npm test -- --reporter=dot`: **669 passed, 0 failed, 0 skipped across 27 files**. This includes 14 API-key UI tests covering save/mask/no-plaintext, startup status, replacement, confirmed/canceled/failed removal, failed saves, backend connection result categories, unavailable bridge methods and draft clearing.
- `npm run build`: passed, including main TypeScript compilation, esbuild preload bundling and Vite production renderer build.
- The key editor uses component-local draft state and the existing `setApiKey`, `hasApiKey`, `clearApiKey` and `testConnection` IPC. Failed key-file deletion now rejects instead of reporting success while leaving a key that could reappear after restart.
- `npm run pack`: passed and produced `release/win-unpacked/Pixel.exe` plus the packaged application.
- The esbuild preload graph contains `src/preload/index.ts` and `src/shared/channels.ts`; Electron is the only external runtime import. The unpacked `app.asar` preload is byte-for-byte identical to `dist/main/preload/index.js` and has no local CommonJS imports.
- Live Settings acceptance: **not verified in this environment**. The user reports Pixel launches and its sandbox preload smoke passes on the target laptop. Here, `npm run dev` could not bind Vite because port 5199 was already occupied and Electron then exited with `2147483651`; a separate `npm run dev:electron` attempt exited with code 1 without creating a targetable Pixel window. No credential was available for a real DeepSeek request. Therefore configured status after restart, connection success, encrypted-key UI interaction and a harmless live conversation still require laptop validation using the updated acceptance procedure.
- `npm run test:preload-sandbox`: **not verified** in this Codex desktop environment. The prior smoke attempt exited before startup/preload logs; the user separately reports the preload smoke passed on the target laptop.
- The Windows Forms UIA fixture and AgentExecutor harness are prepared. Real Pixel approval cards, encrypted-key persistence, the new Settings key-management UI, DeepSeek connection/conversation and the real-control UIA flow remain laptop acceptance items.
- Voice availability is probed at runtime and varies by machine and execution context; no fixed STT/TTS availability is claimed.
- Windows CI is configured but was not run from this local tree. It runs the sandbox preload IPC smoke alongside the type checks, full suite, native compilation and distributions; logs, smoke/JUnit results and packages are uploaded and no release is published.

The earlier packaged GPU/renderer child-process failure remains a separate unverified issue. Existing diagnostics record Chromium/Crashpad startup failures before a window appears; those results do not identify the preload as the cause and the preload repair is not evidence of GPU recovery. Keep `--disable-gpu` as a development diagnostic while the packaged GPU path is tested on the target laptop.

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

- The user-reported `window.cyps`/`window.cypsShell` laptop smoke was not repeated here; actual Settings key entry/status, encrypted-key restart persistence, DeepSeek connection/conversation, floating orb, task/approval UI, cursor-follow and the live Pixel UIA approval/action flow remain unverified. The user reports that Pixel launches and the sandbox preload smoke passes on the target laptop, but this runner could not create a Pixel window.
- Runtime launch of the unpacked and portable packages; clean install, upgrade, uninstall and user-data preservation. The unpacked archive contains the verified bundled preload, but this environment could not launch its Electron window.
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
