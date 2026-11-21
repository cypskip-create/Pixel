# Pixel Core Completion 6.2 implementation checklist

The initial 6.2 audit used `e57f11ef4ec2e4b03c436ca68e6488459a2b6eee`;
clipboard/batch-file work is committed in `64e0383484cfcbc35370c9f8aa2498f9428dd15d`.
The current local file-tool follow-on is based on that commit. This checklist is
the execution record; status changes require code and evidence, not
documentation-only claims.

Status key: **Done and verified** means behavior has direct test evidence;
**Implemented, unverified** means code exists but intended Windows behavior has
not been demonstrated; **Partially implemented** means a bounded subset works;
**Missing** means no functioning implementation exists; **Blocked** means an
external runtime, credential, desktop or network dependency prevents validation.

## Wave 1 — Windows acceptance and environment

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| NSIS provisioning fix | Done and verified | Latest run [44786311339](https://github.com/cypskip-create/Pixel/actions/runs/44786311339) is green and built NSIS, portable, unpacked outputs. |
| Hosted typecheck, tests, preload smoke, helper build and package build | Done and verified on `64e0383` | Windows CI run [44869374637](https://github.com/cypskip-create/Pixel/actions/runs/44869374637) passed on the committed clipboard/batch-file SHA. Its job steps include NSIS setup, typecheck, worker tests, sandboxed preload smoke, full tests, native helper compile, unpacked/portable/NSIS packaging and artifact upload. Current local file-search/open changes are not covered. |
| Installed-app clean install, upgrade, uninstall, data preservation | Implemented, unverified | CI builds installer but does not perform interactive install lifecycle acceptance. |
| Settings return button in actual Pixel GUI | Implemented, unverified | Renderer test exists; real desktop run still required. |
| Local Electron GUI launch and sandbox preload | Blocked by local launch environment | Current `npm run test:preload-sandbox` rebuilt the bridge, then Electron exited `2147483651` (`0x80000003`) before its report. CUA saw windows only from a different checkout. Hosted smoke success is on the base SHA and does not verify this local launch failure. |

## Wave 2 — Offline speech

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| Python 3.12 development worker setup | Blocked locally | `npm run setup:voice-dev` refused safely because this host has only Python 3.15 x64; no venv or model data was touched. Hosted CI uses Python 3.12.10. |
| faster-whisper local inference | Partially implemented | Worker and model manager exist. CI protocol/import smoke passes; installed-model inference and known-audio transcript are not proven. |
| whisper.cpp and sherpa-onnx benchmarks | Missing | Research only; no comparable measured corpus run. |
| Kokoro ONNX model inference/playback | Partially implemented | Engine and downloader exist; CI imports runtime only. Real model synthesis/playback and cancellation need acceptance. |
| Alternative TTS comparison | Missing | No real Windows latency/quality benchmark. |
| Voice cloning/profile prototype | Missing | Deferred pending model/voice licensing and explicit consent workflow. |

## Wave 3 — desktop tools

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| Clipboard read/copy/paste/restore agent tools | Partially implemented and unit-verified | Registered main-process `clipboard_read`, `clipboard_copy`, `clipboard_restore`, and `clipboard_paste`; strict schemas, explicit approvals, credential-pattern refusal, bounded text, memory-only conditional restoration limited to non-secret values up to 20,000 characters with timed expiry, verified UIA field write, and session-only chat/task retention after reads. Windows model/clipboard acceptance and IPC history integration test remain outstanding. |
| Documents read/create/edit/export | Partially implemented | Index/search pipeline exists; direct authored document round-trip is incomplete. |
| Batch file operations, filters, duplicates, open/recycle | Partially implemented and unit-verified | Added approved `file_batch_copy`, `file_batch_rename`, `file_find_duplicates`, size/time filters for `file_search`, main-process `file_open` for home-scoped folders and supported documents/images, and approval-gated `file_trash` through Electron `shell.trashItem`. Batches cap at 20 operations, reject overwrite/credential-like names, stage and SHA-256 verify destinations before removing move sources, and report partial source-removal failures. Duplicate scans cap at 1,200 entries, 8 levels, 500 MB total and 50 MB/file. Open verifies OS acceptance and path existence, not visible-window appearance. Trash verifies the original path is absent using a deterministic unit adapter; real Windows Recycle Bin behavior, restore, and visible app confirmation remain unverified. |
| Browser tabs/forms/uploads/downloads | Partially implemented | Added real session-local tab create/list/switch/close agent tools with URL/title verification and schema/executor tests. Real Chromium tab lifecycle remains unverified because browser binaries cannot be downloaded in this network-restricted environment; semantic form locators, upload/download workflow coverage remain incomplete. |
| Screen target freshness, region/display conversion, hierarchy | Partially implemented | Native window identity and screen/display capture paths exist; freshness evidence and richer hierarchy need verification. |
| Editable desktop annotation and export | Missing | Passive UIA rectangle/circle/arrow guidance exists; interactive freehand/editor/export is absent. |
| Pixel Board model workflow and richer exports | Implemented, unverified | Main-process service/tools and tests exist; actual model-generated diagram and user-selected file export need Windows acceptance. |
| System process/network/battery/audio diagnostics | Partially implemented | Added safe adapter-name/protocol-family status to model-facing system info without exposing IP/MAC addresses. Existing diagnostics panel reports CPU, memory, disk, battery and displays. Process, selected-process and audio-device diagnostics remain incomplete. |

## Wave 4 — productivity

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| Notes create/edit/search/project association | Partially implemented | Migration-backed project-scoped note CRUD is exposed to the agent; Notes & Planning supports browse/create/edit/delete plus Markdown/text import and Markdown export through main-process dialogs. Import limits type/size and rejects symlinks; export reads back saved content. Local store/UI tests pass; local document links and Windows acceptance remain open. |
| Checklists/tasks persistent status and agent tools | Implemented, locally unit-verified; Windows acceptance open | Migration 9 adds project-owned checklists and task grouping; model tools can create/list checklists and create/list/update tasks within the active project. Workspace creates, filters and assigns checklists and edits task title/description/due date/status. |
| Local document linking and Markdown import/export | Partially implemented | Markdown/text import and Markdown export are implemented for notes through the main-process file-dialog IPC; linked-note relationships and Windows file-dialog acceptance remain missing/unverified. |

## Wave 5 — workflows and specialists

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| User-initiated semantic workflow recording/replay | Missing | Workflow/routine persistence exists; live semantic recording/review/replay is not connected. |
| Routine execution status/history | Partially implemented | Local scheduling and run persistence exist; validate UI status and restart behavior. |
| Live specialist delegation | Missing | Bounded coordinator module exists but is not called from the live agent runtime. |
| Durable task checkpoints, postconditions and crash recovery | Partially implemented | Snapshot/recovery and evidence exist; automatic continuation is intentionally absent; real end-to-end acceptance is outstanding. |

## Wave 6 — permission policy

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| Guide/Hybrid/Agent mode and scoped grants | Partially implemented | Main-process registry/broker, session and exact process/title persistent observation grants exist; full real workflow policy matrix still needs tests. |
| Critical risk class and consistent risk policy | Implemented locally; automated-only | Added a five-tier consequence matrix and dynamic `critical` classification for explicit `browser_type.submit`. Critical submissions require a one-action approval; main-process broker and registry reject session/Always grants. Focused tests pass, but real approval UI and browser submission acceptance remain unverified. |
| Emergency stop and audit | Implemented, unverified | Unit coverage exists; verify with real pending approval, desktop work, voice and overlay on Windows. |

## Wave 7 — real Windows tasks

| Scenario | Initial status | Evidence / remaining work |
|---|---|---|
| Notepad write and verify | Implemented, unverified | Native/UIA tests exist; run through real DeepSeek agent on target laptop. |
| Screen inspect and highlight | Implemented, unverified | Scoped screen/UIA tools exist; live capture/overlay acceptance missing. |
| Board diagram and save | Implemented, unverified | Board tool tests exist; model-call and Windows export acceptance missing. |
| File organization and document summary | Partially implemented | Base operations exist; batch operations and authored-document round trip absent. |
| Website form workflow | Partially implemented | Playwright tools exist; target-browser acceptance and upload/download coverage missing. |
| Saved checklist, recorded workflow, specialist use | Missing | Required capabilities are not connected/implemented. |
| Offline transcription and neural speech | Blocked | Requires Python 3.12, downloaded model assets, audio/speaker device and Windows acceptance. |

## Wave 8 — release gate

| Gate | Initial status | Evidence / remaining work |
|---|---|---|
| GitHub Windows CI on audited SHA | Done and verified | Run 44786311339 completed successfully, including artifact upload. |
| Local typecheck/test/build repeat | Done and verified (local only) | Current worktree typecheck and production build passed; Vitest **893 passed, 28 skipped, 0 failed (921 total; 64 files passed, 1 skipped)**. The 28 skips require Chromium, makensis/NSIS, or opt-in Windows foreground integration. The suite used `PIXEL_TEST_HOME` set to a writable isolated workspace directory. No hosted CI run covers this local tree. |
| Native/helper/voice tests | Done and verified in bounded local checks | Native helper compilation passed; Python worker tests 12/12 passed. These do not establish microphone inference or neural playback with real models. |
| Windows GUI and installer lifecycle | Blocked | Must use actual interactive Windows Pixel installation; hosted packaging is not this acceptance. |
| Final capability matrix | In progress | Update after implementation; do not set overall completion while any required row is missing, blocked, or unverified. |

## Implementation log

The initial 6.2 audit found no registered clipboard agent tools. Clipboard,
file, browser-tab and productivity additions are local implementation slices;
the remaining rows are intentionally not marked complete from the 6.1 research
report. That report is supporting context, not completion evidence for the
other capabilities above.

### Local implementation evidence

- Clipboard tools are in the existing `BUILTIN_TOOLS` registry and central
  `ToolExecutors` dispatch, using Electron main-process clipboard access only.
- `clipboard_read` requires fresh approval and common credential/bearer patterns
  are refused. The triggering chat becomes session-only before read results can
  be persisted. Task history stores a fixed non-content summary; audit/task-step
  summaries do not include clipboard text.
- `clipboard_copy` masks text in approval UI and task arguments, verifies
  read-back and stores the prior plain-text clipboard only in a bounded,
  five-minute in-memory snapshot. Restore succeeds only while the clipboard
  still equals the value Pixel wrote. Emergency stop clears snapshots.
- `clipboard_paste` is deliberately defined as setting one exact UIA
  `ValuePattern` field to clipboard text; it replaces the field value and does
  not simulate caret-position Ctrl+V. It is approval-gated, secret-pattern
  guarded, and verifies the control value through the native helper.
- Focused file/agent suites passed **53/53**, and clipboard/file/agent passed
  **59/59** after adding the Recycle Bin adapter path. The full suite passed
  **880**, skipped **27**, failed **0**
  (907 total; 62 files passed, 1 skipped). The test harness uses the
  opt-in test-only `PIXEL_TEST_HOME` variable to keep temporary file fixtures
  inside the writable workspace; production home resolution is unchanged.
- `npm run typecheck`, `npm run build`, `npm run build:native`, and
  `npm run test:voice-worker` passed locally; Python worker tests were **12/12**.
- No local Windows GUI or interactive installed-app acceptance was achieved.
  The green GitHub run is on the audited base SHA, not this uncommitted change.
- The existing home-scoped `FileTools` now also registers batch copy, batch
  move/rename, duplicate scanning, metadata filters and a main-process open
  request with strict schemas and fresh approvals. Focused file tests pass in
  the isolated fixture root; recycle/restore and laptop execution are still
  outstanding.
- Browser tab tools are registered in the central tool registry and shared
  executor. Chromium-dependent lifecycle tests were added but could not execute:
  Playwright download failed at `cdn.playwright.dev` with DNS `ENOTFOUND`.
- Added project-scoped productivity migration 8 and `ProductivityStore` /
  `ProductivityTools`. Notes/tasks are model-visible, strict-schema validated,
  isolated to the trusted active project and checked by database read-back.
  Six local tests cover schemas, executor wiring, CRUD and cross-project refusal.
  The Workspace supports note/task browse, edit and create flows, Markdown
  import/export, task descriptions/due dates and checklist assignment. Local
  document links and real Windows acceptance remain open.

## 2026-11-21 follow-on: critical-risk classification

- Added `critical` to the shared risk type and a centralized consequence
  matrix. Tool metadata may raise approval requirements but cannot lower the
  matrix floor.
- `browser_type` with `submit: true` is dynamically classified as critical;
  the approval UI labels information submission and disallows session or
  persistent authorization. Registry and broker recheck those restrictions in
  the main process. High and critical session grants are refused.
- Focused registry, permission-store, memory and plugin/browser suites passed
  during initial checks. The latest full run passed **901 tests**, skipped
  **28**, failed **0** (929 total; 65 files passed, 1 skipped). `npm run
  typecheck` and `npm run build` passed. Chromium-dependent browser checks,
  NSIS checks and the opt-in native foreground fixture remain skipped.
- This does not finish the 6.2 acceptance matrix. It does not add desktop
  drawing, document authoring, UIA installation verification, file restoration,
  full browser form/session/network acceptance, local document links, persistent
  agent recovery, voice inference, or installed-app acceptance.
- Overall Core Tools status remains **in progress**.
