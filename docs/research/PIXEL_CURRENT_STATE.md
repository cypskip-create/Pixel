# Pixel current state

**Reviewed:** 2026-11-16  
**Repository:** Pixel 0.2.1, `main` at review start  
**Method:** source inspection, the repository's automated suite, TypeScript checks, production renderer/main builds and direct Windows helper checks. Electron GUI startup and packaging were attempted but blocked by this Codex environment.

## Status meanings

- **Working and tested:** automated tests exercise the code path; this does not imply a live provider or Windows desktop test.
- **Implemented but unverified:** code is present, but the relevant runtime or packaging check did not run here.
- **Partially implemented:** a useful part works, with a material integration or behavior gap.
- **Missing:** no current implementation was found.
- **Defective:** a reproducible implementation bug is known.
- **Superseded:** an older implementation or claim no longer describes the current source.

## Capability inventory

| Capability | Current status | Source evidence and limits |
| --- | --- | --- |
| Electron desktop shell, renderer and typed preload bridge | Implemented but unverified | Electron main, React renderer and allow-listed bridge exist. Compile/build checks pass. A live window, tray, shortcuts, focus, DPI and monitor behavior were not exercised in this run. |
| DeepSeek conversation and streaming | Working and tested at protocol level | Provider parsing, errors, streaming and conversation tests pass. No live DeepSeek request was made. Ollama is an optional local provider. |
| Agent tool loop | Working and tested | `src/main/agent/executor.ts` runs bounded model/tool turns, enforces mode and stop policy, and validates model arguments. It is one active run at a time. Planning is implicit in model tool calls; there is no separately persisted plan object. |
| Durable tasks and restart recovery | Implemented and unit tested | `TaskStore` persists validated SQLite snapshots and transition summaries. Active or paused tasks restore as paused with a recovery note; old approvals and call stacks are not resumed. Recovery is review-and-restart, not continuation from a serialized instruction pointer. |
| Task controls and timeline | Implemented but UI-unverified | Task list hydration, compact step rail, pause/resume/cancel and verification state are wired through IPC. Task progress is based on recorded steps; task state, not a progress bar, is authoritative. |
| Task budgets | Partially implemented | Wall-clock, turn and approximate model-token ceilings exist. Token counts are estimates; retry counters are currently zero and there is no provider-cost ceiling on each task. |
| Action verification | Partially implemented | File writes read back exact content; document indexing checks SQLite stats; memory save/delete read back; browser navigation checks its destination; browser click/type can be followed by `browser_verify`; native UIA invocation carries an exact present/absent postcondition that must be observed in the same titled window. Other successful state changes remain explicitly pending verification and end as `blocked`, not `completed`. There is no general postcondition language for arbitrary desktop actions. |
| Pause and cancellation | Working in unit tests; live worker coverage incomplete | Agent, tool deadlines, browser closure, Python worker, child processes, voice worker and the native helper process accept cancellation or bounded termination. Cancellation cannot undo an external action that already completed. |
| Approval policy | Working and unit tested | Main-process policy gates state changes. High-risk grants are single-use. Medium-or-lower persistent grants require a target scope; scopes currently cover app, browser navigation origin and document-index directory. Grants live in memory and reset on restart. |
| Prompt-injection boundaries | Partially implemented | System instructions and file/document result framing treat retrieved content as untrusted; browser network policy blocks private destinations. A model may still be influenced by malicious content, so consequential actions still require main-process authorization and user approval. |
| Browser | Implemented; live browser tests unavailable | Playwright session, visible DOM snapshot, CSS actions, screenshots, URL verification, private-address checks, per-request routing and post-connect address checks exist. Chromium was not installed: 17 browser integration cases were skipped. DNS rebinding is detected after Chromium connects; preventing the connection itself would require a controlled egress proxy. |
| Windows input and app launching | Partially implemented | Allow-listed app launch, approved `SendKeys` and a shared lease exist. `type_text` requires the exact foreground title in its approval args and rechecks it inside the Windows child process before input. A focus change can still race after that final check; no input action can be rolled back. |
| Native Windows accessibility | Implemented; limited live checks passed | The C# helper compiled on Windows. Direct calls returned a foreground window, searched the current UIA tree and refused an invocation when the approved title mismatched. Approved tools expose title/bounds, bounded semantic search, exact unique enabled `InvokePattern` activation, and exact UIA control presence/absence postconditions. Invocation requires the requested postcondition to be false beforehand; no real control was invoked, so application transitions and provider behavior remain unverified. |
| Cursor companion | Implemented but GUI-unverified | Settings expose stationary/cursor presentation. The main process follows the global DIP pointer with spring motion, display work-area clamping and polling only while the compact orb is visible. It pauses while expanded; focus, click-through, edge transitions and mixed-DPI behavior need desktop acceptance. |
| Screen capture and visual analysis | Implemented but unverified on desktop | On-demand screen capture and a vision-model call are connected. Capture requires approval. The Windows capture, DPI, active-window and multi-monitor paths were not exercised in a GUI session. UIA can search and invoke, but there is no end-to-end highlight/pointing overlay. |
| Voice | Partially implemented | Local Windows speech through PowerShell/System.Speech, capability probing and cancellation are present. The current test probe found TTS available and STT unavailable. Push-to-talk state logic is tested; microphone interaction was not verified in the UI. |
| Memory | Working and tested | SQLite memory is project-scoped and supports save, search, list, correction, deletion and JSON export. Secret-like values are rejected; writes/deletes are read back. It is not the permission system. |
| Skills/workflows | Partially implemented | Versioned semantic skill drafts, explicit review/activation, secret checks, immutable versions, hashes and run history have SQLite/UI support. Native/browser/tool steps can be used through a task-level allowlist and the ordinary approval gateway. Runs are model-mediated; deterministic replay is still caller-driven. No recorder or save-from-completed-task flow exists. |
| Specialist agents | Partially implemented | Bounded specialist definitions and a coordinator enforce allowlists/budgets when called. They are not model-backed or wired into the user task flow. Infrastructure and Pixel Code are deliberately unavailable. |
| Routines and scheduler | Implemented; runtime not GUI-verified | Daily local schedules persist timezone, enabled state, idempotent occurrence keys and history. Missed occurrences are marked/skipped, interrupted work is not replayed, runs serialize, failures pause the routine, and retry is a user-confirmed one-time action. They run only while Pixel is alive. |
| General credential vault | Missing | The DeepSeek API key is encrypted using Electron `safeStorage` (DPAPI on Windows) and is not returned to the renderer. There is no service-scoped login vault or secure form-fill broker. |
| Audit | Working and tested | JSONL audit is persistent and redacted; task transitions have a separate SQLite event history. The complete audit/task timeline has no dedicated export or review panel. |
| Installer and package identity | Implemented but unverified in this run | Existing app identity, migration and repair work are retained. Packaging structure tests passed; NSIS integration cases were skipped because `makensis` was unavailable. Installer, portable app, upgrade and uninstall were not run. |

## Validation observed for this review

- Latest after the UIA postcondition changes: `npm run typecheck`, `npm run build`, and `npm run build:native` passed. `git diff --check` passed with line-ending warnings only.
- The full Vitest suite had passed earlier (**619 passed, 24 skipped** across 25 files) before the final UIA postcondition changes; it was not rerun afterward. Earlier skips: 17 browser cases because the Playwright Chromium binary is absent; 7 NSIS cases because `makensis` is absent.
- Earlier direct Windows checks covered native protocol ping, foreground window, bounded search and title-mismatch refusal. The new postcondition path compiled but was not exercised against a real application control.
- Electron main process launch was attempted with a fresh workspace-local profile and exited before creating a window (`-2147483645`), matching the environment restriction in [ELECTRON-CONSTRAINTS.md](../ELECTRON-CONSTRAINTS.md). Packaging stopped because electron-builder could not resolve `github.com`; no newly packaged executable was validated.

The remaining laptop-side procedure is in [PIXEL_WINDOWS_ACCEPTANCE.md](../validation/PIXEL_WINDOWS_ACCEPTANCE.md). Older reports in `docs/WINDOWS-VALIDATION.md` and installer notes describe older revisions and must not be used as current test counts.

## Architectural conclusion

Pixel is already a modular Electron/TypeScript monolith with SQLite and isolated worker boundaries. The new task, skill, routine, memory, handoff and bounded UIA features fit this structure; they do not justify replacing Electron or splitting the app into network services. The highest-value remaining seams are deterministic semantic skill replay/recording, model-backed specialist delegation, credential brokering, generalized postconditions, GUI acceptance and package validation.
