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

Latest source checks after adding the exact UIA postcondition flow:

- `npm run typecheck`: passed.
- `npm run build`: passed; main bundle and Vite renderer production output generated.
- `npm run build:native`: passed; the .NET Framework C# helper compiled. The build script printed its manual ping command; no native request was run during this final check.
- `git diff --check`: passed; Git only reported existing line-ending normalization warnings.
- The full Vitest suite had passed earlier in this review (**619 passed and 24 skipped** across 25 files), before the final UIA postcondition implementation. It was not rerun afterward. The earlier skips were 17 browser cases (Chromium absent) and 7 NSIS cases (`makensis` absent).
- Earlier direct Windows checks covered protocol ping, foreground window, bounded UIA search and title-mismatch refusal. The new present/absent postcondition path compiled but was not exercised against a real app control.
- The exact-title refusal for `type_text` was exercised through the actual Windows PowerShell child process; no text was sent.
- Electron GUI startup still fails in this Codex environment with exit `-2147483645`, consistent with the existing [Electron constraints report](docs/ELECTRON-CONSTRAINTS.md). Packaging also stopped when electron-builder could not resolve `github.com` to fetch its Windows signing/edit helper. No current packed app, installer, tray, multi-monitor, microphone or full UI behavior was validated.

See [the current-state report](docs/research/PIXEL_CURRENT_STATE.md) and [Windows acceptance procedure](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md) for detailed evidence and limits.

## Major work still open

- Cursor following and native UIA tools need acceptance on a normal Windows desktop, especially mixed-DPI displays, accessibility-provider edge cases and actual approval-card behavior. UIA postconditions cover accessible control presence/absence only; they do not read values or verify a newly titled window.
- Native UIA exposes a limited safe subset. It cannot set form values, read editable control values, reliably identify process names in every app, or click inaccessible/custom controls.
- Skills are reviewed and runnable through the task model with per-skill tool allowlists, but there is no interaction recorder or deterministic live semantic replay runner. The standalone workflow replay API remains caller-driven.
- Specialist roles and budgets exist, but no independent model-backed delegation path is connected to the user task flow. VirtualBox/SSH and Pixel Code remain unavailable.
- There is no general credential broker; account passwords, payment data and authentication challenges must remain human-controlled.
- Task recovery is manual review and a new request, not automatic continuation.
- Full GUI/packaged launch, Playwright Chromium and NSIS validation remains for a normal Windows desktop/build environment with network access to GitHub.

## Research and architecture

- [Pixel current state](docs/research/PIXEL_CURRENT_STATE.md)
- [Grok Bot behavior matrix](docs/research/GROK_BOT_FEATURE_MATRIX.md)
- [Original Clicky mapping](docs/research/CLICKY_TO_PIXEL_MAPPING.md)
- [Agent runtime](docs/architecture/PIXEL_AGENT_RUNTIME.md)
- [Security model](docs/architecture/PIXEL_SECURITY_MODEL.md)
- [Skills and routines](docs/architecture/PIXEL_SKILLS_AND_ROUTINES.md)
- [Windows acceptance](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md)
- [Handoff](WAVE_HANDOFF.md)
