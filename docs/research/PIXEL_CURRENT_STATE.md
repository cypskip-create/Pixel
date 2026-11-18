# Pixel current state

**Reviewed:** 2026-11-17
**Repository:** Pixel 0.2.1, local branch `codex/ui-experience-2`; current `HEAD` is `f10084e6f11129e4c453ba546ed09e50e6b9d8de` and the worktree is uncommitted.
**Method:** source inspection, TypeScript checks, full Vitest suite and production source build. GUI acceptance was not completed; the isolated package build failed before producing an artifact because DNS resolution for `github.com` failed.

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
| Electron desktop shell, renderer and typed preload bridge | Implemented; branch GUI acceptance unverified | Main, renderer and the narrow sandboxed preload build. The primary window is anchored to a selected display and renderer-measured content determines its bounds. This run did not verify native window visuals, focus, DPI or monitor behavior. |
| DeepSeek conversation and streaming | Working and tested at protocol level | Provider parsing, errors, streaming and conversation tests pass. No live DeepSeek request was made. Ollama is an optional local provider. |
| Agent tool loop | Working and tested | `src/main/agent/executor.ts` runs bounded model/tool turns, enforces mode and stop policy, and validates model arguments. It is one active run at a time. Planning is implicit in model tool calls; there is no separately persisted plan object. |
| Durable tasks and restart recovery | Implemented and unit tested | `TaskStore` persists validated SQLite snapshots and transition summaries. Active or paused tasks restore as paused with a recovery note; old approvals and call stacks are not resumed. Recovery is review-and-restart, not continuation from a serialized instruction pointer. |
| Task controls and timeline | Implemented but UI-unverified | Task list hydration, compact step rail, pause/resume/cancel and verification state are wired through IPC. Task progress is based on recorded steps; task state, not a progress bar, is authoritative. |
| Task budgets | Partially implemented | Wall-clock, turn and approximate model-token ceilings exist. Token counts are estimates; retry counters are currently zero and there is no provider-cost ceiling on each task. |
| Action verification | Partially implemented | File writes read back exact content; document indexing checks SQLite stats; memory save/delete read back; browser navigation checks its destination; browser click/type can be followed by `browser_verify`; native UIA invocation carries an exact present/absent postcondition that must be observed in the same titled window. Other successful state changes remain explicitly pending verification and end as `blocked`, not `completed`. There is no general postcondition language for arbitrary desktop actions. |
| Pause and cancellation | Working in unit tests; live worker coverage incomplete | Agent, tool deadlines, browser closure, Python worker, child processes, voice worker and the native helper process accept cancellation or bounded termination. Cancellation cannot undo an external action that already completed. |
| Approval policy | Working and unit tested | Main-process policy gates state changes. High-risk grants are single-use. Medium-or-lower persistent grants require a target scope; scopes currently cover app, browser navigation origin and document-index directory. Grants live in memory and reset on restart. |
| Prompt-injection boundaries | Partially implemented | System instructions and file/document result framing treat retrieved content as untrusted; browser network policy blocks private destinations. A model may still be influenced by malicious content, so consequential actions still require main-process authorization and user approval. |
| Browser automation | Implemented; unit and integration tests depend on Chromium | Playwright session, visible DOM snapshot, CSS actions, screenshots, URL verification, private-address checks, per-request routing and post-connect address checks exist. In the current checkpoint, Chromium-dependent tests were skipped because the browser was unavailable. DNS rebinding is detected after Chromium connects; preventing the connection itself would require a controlled egress proxy. |
| Persistent chat history and Recent Chats | Implemented; Windows restart acceptance unverified | Main-process history owns conversation IDs and trusted context retrieval. Sanitized user/assistant transcripts are stored through the existing HistoryStore when `privacy.persistHistory` is enabled; disabled/failed persistence uses a bounded session-only map. Recent Chats supports search, project scope, paging, create, restore, rename and confirmed delete/clear. Reasoning, tool records and image payloads are excluded. |
| Explicit web search | Implemented; system-browser GUI acceptance unverified | Clear search commands are parsed before model invocation; ordinary questions are not treated as searches. Query URLs use a configured Google, Bing or DuckDuckGo HTTPS endpoint and are opened through main-process `shell.openExternal`. Model-proposed searches use the existing approval gateway. Pixel reports launch success only; it does not read search results. |
| Windows input and app launching | Partially implemented | Allow-listed app launch, approved `SendKeys` and a shared lease exist. `type_text` requires the exact foreground title in its approval args and rechecks it inside the Windows child process before input. A focus change can still race after that final check; no input action can be rolled back. |
| Native Windows accessibility | Implemented; UI task acceptance unverified | The C# helper compiled. Tool contracts and timeout/cancellation/crash recovery tests pass; timeout/cancellation stop the helper tree, and unconfirmed termination quarantines it while retaining the desktop-input lease. The fixture-driven AgentExecutor harness is prepared, but this desktop session could not foreground its test form, so no real control was invoked. Visible Pixel approval-card behavior and real provider postconditions remain unverified. |
| Cursor companion | Implemented but GUI-unverified | Settings independently enable a separate 36 DIP transparent, non-focusable, click-through window with 28 DIP monochrome artwork. Bounded spring motion, work-area edge flipping, lifecycle hiding and resume snapping are implemented; native click-through, visual size and mixed-DPI behavior still need desktop acceptance. |
| Screen capture and visual analysis | Implemented but unverified on desktop | On-demand screen capture and a vision-model call are connected. Capture requires approval. The Windows capture, DPI, active-window and multi-monitor paths were not exercised in a GUI session. UIA can search and invoke, but there is no end-to-end highlight/pointing overlay. |
| Voice | Partially implemented | Local Windows System.Speech, capability probing and cancellation are present. Recognition/synthesis probe results differed by execution context during this checkpoint; capability is not fixed or assumed. Push-to-talk state logic is tested; microphone interaction was not verified in the UI. |
| Memory | Working and tested | SQLite memory is project-scoped and supports save, search, list, correction, deletion and JSON export. Secret-like values are rejected; writes/deletes are read back. It is not the permission system. |
| Skills/workflows | Partially implemented | Versioned semantic skill drafts, explicit review/activation, secret checks, immutable versions, hashes and run history have SQLite/UI support. Native/browser/tool steps can be used through a task-level allowlist and the ordinary approval gateway. Runs are model-mediated; deterministic replay is still caller-driven. No recorder or save-from-completed-task flow exists. |
| Specialist agents | Partially implemented | Bounded specialist definitions and a coordinator enforce allowlists/budgets when called. They are not model-backed or wired into the user task flow. Infrastructure and Pixel Code are deliberately unavailable. |
| Routines and scheduler | Implemented; runtime not GUI-verified | Daily local schedules persist timezone, enabled state, idempotent occurrence keys and history. Missed occurrences are marked/skipped, interrupted work is not replayed, runs serialize, failures pause the routine, and retry is a user-confirmed one-time action. They run only while Pixel is alive. |
| General credential vault | Missing | The DeepSeek API key is encrypted using Electron `safeStorage` (DPAPI on Windows) and is not returned to the renderer. There is no service-scoped login vault or secure form-fill broker. |
| Audit | Working and tested | JSONL audit is persistent and redacted; task transitions have a separate SQLite event history. The complete audit/task timeline has no dedicated export or review panel. |
| Installer and package identity | Previous build verified; current branch packaging blocked | Earlier unpacked/ZIP/portable/NSIS outputs were built with publishing disabled, and the existing appId, NSIS GUID, user-data path and repair scripts remain intact. The current UI Experience 2.0 package attempt failed on DNS lookup for `github.com` before output; runtime launch, clean install, upgrade, uninstall and data preservation remain unverified for this branch. |

## Earlier validation (before UI Experience 2.0)

- `npm run typecheck`: passed for renderer and main TypeScript projects.
- `npm test`: **651 passed, 0 failed, 0 skipped across 25 test files**. The final run included all 22 Chromium browser tests and all 9 NSIS tests. It ran with Chromium installed and outside the default sandbox because Chromium's local HTTP fixture was denied loopback access in the sandbox.
- `npm run build` and `npm run build:native`: passed. The C# helper compiled with the Windows .NET Framework compiler.
- `npm run pack`: passed after excluding Playwright's package-local test browser cache from the application. The unpacked package contains `Pixel.exe` and `resources/native/PixelNative.exe`, and does not contain the test browser cache.
- `npm run dist`: passed and produced the NSIS installer, portable executable and unpacked ZIP with `--publish never`.
- `npm run dev`: Vite started, but Electron exited before main startup logs or window creation (`2147483651`, signed `-2147483645`). Renderer/preload runtime, orb, task UI and cursor behavior were not exercised.
- `npm run test:native-uia-e2e`: prepared but could not be completed here because the harmless fixture did not appear in the foreground desktop session. It stopped before invoking the control; no action is reported as passed.
- Voice capability output varied by execution context; it is not recorded as a stable machine capability. Pixel UI/microphone behavior remains unverified.

The preceding review's counts describe its own source revision only. See
[`PIXEL_RELEASE_READINESS.md`](../validation/PIXEL_RELEASE_READINESS.md) for the
current checkpoint totals, package outcome and Windows acceptance limits.

## Current UI Experience 2.0 validation

- `npm run typecheck`: passed.
- Focused changed-area suite: **69 passed across 8 files**.
- Full suite: **712 passed, 0 failed, 26 skipped across 36 files (738 tests total)**. The skipped tests need Playwright Chromium, NSIS, or the opt-in Windows foreground integration.
- A later repeat was interrupted before Vitest returned a result; the total above is the latest completed run.
- `npm run build`: passed for main TypeScript output, esbuild sandbox preload and Vite renderer.
- `npm run test:preload-sandbox`: blocked before the harness main-entry marker. Electron 45.2.3 exited with `2147483651` (`0x80000003`) without writing the smoke report, so this run did not execute bridge assertions. The harness now clears stale reports and records launcher metadata and Electron stderr for the next run.
- Isolated unpacked package build: blocked before output by electron-builder `getaddrinfo ENOTFOUND github.com`; no new package was produced and existing `release` artifacts were preserved.
- Windows GUI, packaged launch, settings/history restart behavior, browser launch, DPI and monitor behavior: unverified in this run. The Computer Use attempt ended before app selection.
- GitHub status for the remote `main` HEAD (`0be3ba45b5b94a2018969670490a8c9b6ad8e80b`) returned no status checks, and the GitHub connector exposed no workflow run for this unpushed local branch. The CI preload-smoke failure therefore has no accessible Actions job log here. This runner's smoke failure occurs before app/preload execution; the remote cause remains unknown without its Actions log. `npm run test:preload-sandbox` remains the exact laptop/CI repro command.

See [`PIXEL_WINDOWS_ACCEPTANCE.md`](../validation/PIXEL_WINDOWS_ACCEPTANCE.md)
for the exact UI, persistence, browser-search and packaging procedure.

## Architectural conclusion

Pixel is already a modular Electron/TypeScript monolith with SQLite and isolated worker boundaries. The new task, skill, routine, memory, handoff and bounded UIA features fit this structure; they do not justify replacing Electron or splitting the app into network services. The highest-value remaining seams are deterministic semantic skill replay/recording, model-backed specialist delegation, credential brokering, generalized postconditions, GUI acceptance and package validation.
