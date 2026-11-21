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

## Continuation status — 2026-11-21

The current source still leaves Core Tools 6.2 **in progress**. This continuation
does not claim previously listed gaps are repaired merely from documentation.
The Workspace redesign does not close the remaining 6.2 acceptance gaps. A
separate task-to-skill recording and guarded skill-review slice is now
implemented below. The prior
committed-source CI run [44882229282](https://github.com/cypskip-create/Pixel/actions/runs/44882229282)
passed; it is not Windows interactive acceptance for this local tree.

The current capability gaps confirmed against the source/checklist are:

| Capability | Current source-backed state | Evidence still required |
|---|---|---|
| Document creation/edit/export | Notes import/export Markdown, and the approved `file_write` tool creates/edits UTF-8 text documents with exact-path approval and read-back. Known binary PDF/Office/media formats are refused instead of being corrupted by text output. General rich-document authoring/export and automatic provenance linking remain incomplete. | Text round-trip tests pass; supported Windows dialogs and PDF/Office authoring are not available. |
| Browser lifecycle/forms/transfers | Tab lifecycle, exact accessible targeting, field read-back, credential/one-time-code refusal, explicit submission postconditions, user-selected file upload with critical approval plus native file/site confirmation, and user-selected download with a 25 MB cap, no-overwrite write and SHA-256 read-back are implemented. | 30 Chromium tests pass on cached real Chromium against disposable local-file fixtures; one covers actual file input selection and one actual browser download/read-back. Upload acceptance by a remote site is deliberately not claimed. Electron native dialogs, external network/session isolation and actual app acceptance remain unverified. Host loopback access is denied, so fixture tests explicitly permit local files only. |
| Desktop recovery/annotation/diagnostics | File trash uses the OS adapter but restore is absent; UIA annotation remains guidance-only; richer diagnostics remain partial. A disposable `SendToRecycleBin` probe made its source path disappear, but the Shell Recycle Bin namespace returned zero entries, so no restore verb was invoked and restore behavior remains unsupported/unverified on this host. | Verified Recycle Bin enumeration and exact-source restore; target-window freshness, editable annotation/export, live UIA. |
| Notes and local document links | Project-scoped notes/tasks/checklists persist. Note-to-local-document links now have a migration-backed store, scoped IPC, renderer-safe metadata, native file selection, verified open and unlink controls in Notes. | Storage tests cover deduplication, project isolation, directory refusal and unlink. Actual Windows file-dialog/open acceptance remains unverified. |
| Semantic workflows | The Tasks view can convert a completed, verified task into a project-scoped skill draft. Main-process checks require a completed task in the active project, known tools and at most 40 successful steps; all string arguments become required inputs, and withheld/secret/unsupported values are refused. Draft JSON is editable and saves a new immutable version before activation. Daily routines invoke the ordered reviewed tool plan directly through the central executor; the model does not select or reorder steps. A one-time form supplies declared inputs, rechecks schemas and current permission policy, refuses credential-like values, and redacts values from task/audit text. | Executor, plan-builder, input-redaction and renderer bridge tests pass. Actual Windows flow remains unverified. Daily routines still exclude input-bearing skills; non-tool semantic steps and broader expectation predicates remain unsupported. |
| Specialist coordination | Live bounded model delegation is implemented for research/browser/systems/knowledge through the main executor; it carries permissions, cancellation and task history. | Existing integration tests cover tool allowlists, approval flow and postcondition; Windows execution and durable task recovery still require acceptance. |
| Voice | Offline components are present, but this host reports `stt=false`, `tts=true`; actual model assets/inference/playback are not qualified. | Packaged runtime, model assets, real synthesis/transcription and playback. |
| Windows acceptance | GitHub CI passed its source checks and package jobs on the committed baseline. Current-session Computer Use inventory (2026-11-21) exposed no Pixel window after the user accepted the Electron permission prompt, so no real Workspace capture or interactive acceptance could be performed. | Launch Pixel successfully, then verify UIA/Notepad/browser, package install and user-data preservation. The earlier Electron `0x80000003` launch failure remains the source/runtime blocker to diagnose; do not treat CI or component tests as GUI acceptance. |

Core Tools 6.2 remains open; automated feature coverage does not replace the
listed current-tree Windows acceptance and deterministic replay evidence.

## Wave 1 — Windows acceptance and environment

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| NSIS provisioning fix | Done and verified | Baseline run [44882229282](https://github.com/cypskip-create/Pixel/actions/runs/44882229282) is green and built packages. It predates this uncommitted local redesign. |
| Hosted typecheck, tests, preload smoke, helper build and package build | Done and verified on `64e0383` | Windows CI run [44869374637](https://github.com/cypskip-create/Pixel/actions/runs/44869374637) passed on the committed clipboard/batch-file SHA. Its job steps include NSIS setup, typecheck, worker tests, sandboxed preload smoke, full tests, native helper compile, unpacked/portable/NSIS packaging and artifact upload. Current local file-search/open changes are not covered. |
| Installed-app clean install, upgrade, uninstall, data preservation | Implemented, unverified | CI builds installer but does not perform interactive install lifecycle acceptance. |
| Settings return button in actual Pixel GUI | Implemented, unverified | Renderer test exists; real desktop run still required. |
| Local Electron GUI launch and sandbox preload | Blocked by local launch environment | Earlier `npm run test:preload-sandbox` exited `2147483651` (`0x80000003`) before its report. The default launcher now uses Vite's actual loopback port (with fallback if 5199 is occupied); launcher tests verify an existing listener is preserved. Both `npm run dev` and `npm run dev:gpu` rebuilt main/preload/native code, started Vite at `127.0.0.1:5199`, then exited with `2147483651` (`0x80000003`) without a targetable window. `ELECTRON_ENABLE_LOGGING=1` plus stack dumping exposed `EXCEPTION_BREAKPOINT` and an unresolved native backtrace before Pixel's boot marker. The existing startup log has no marker from this checkout; Windows denied Application event-log access. Isolated temporary APPDATA did not change the earlier result. A visible Pixel window belongs to a separate `C:\dev\Pixel` checkout. No source-tree GUI acceptance is claimed. |

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
| Documents read/create/edit/export | Partially implemented | Provenance-linked index/search is implemented. Approved `file_write` authors/edits supported UTF-8 text and verifies read-back; tests cover Markdown/CSV/JSON plus refusal to overwrite binary PDF data. General PDF/Office authoring and export remain unsupported. See `docs/architecture/PIXEL_DOCUMENT_ASSISTANCE.md`. |
| Batch file operations, filters, duplicates, open/recycle | Partially implemented and unit-verified | Added approved `file_batch_copy`, `file_batch_rename`, `file_find_duplicates`, size/time filters for `file_search`, main-process `file_open` for home-scoped folders and supported documents/images, and approval-gated `file_trash` through Electron `shell.trashItem`. Batches cap at 20 operations, reject overwrite/credential-like names, stage and SHA-256 verify destinations before removing move sources, and report partial source-removal failures. Duplicate scans cap at 1,200 entries, 8 levels, 500 MB total and 50 MB/file. Open verifies OS acceptance and path existence, not visible-window appearance. Trash verifies the original path is absent using a deterministic unit adapter; real Windows Recycle Bin behavior, restore, and visible app confirmation remain unverified. |
| Browser tabs/forms/uploads/downloads | Partially implemented | Session-local tabs, semantic forms, explicit submission postconditions, and transfers now share the same executor and policy path. Upload requires a critical per-action agent approval and a second native confirmation after file selection; credential-like filenames, symlinks, non-regular files and files over 25 MB are refused. The page target must be a unique enabled file input; attachment metadata is read back, but this does not prove site acceptance. Download requires fresh approval and native save destination, is capped at 25 MB, refuses overwrite and verifies the new file by size and SHA-256. Cached real Chromium passes **30/30** tests including actual disposable upload/download operations. Electron dialogs, remote site acceptance, real app/network session isolation and Windows UI acceptance remain unverified; host loopback networking is denied. |
| Screen target freshness, region/display conversion, hierarchy | Partially implemented | Native window identity and screen/display capture paths exist; freshness evidence and richer hierarchy need verification. |
| Editable desktop annotation and export | Missing | Passive UIA rectangle/circle/arrow guidance exists; interactive freehand/editor/export is absent. |
| Pixel Board model workflow and richer exports | Implemented, unverified | Main-process service/tools and tests exist; actual model-generated diagram and user-selected file export need Windows acceptance. |
| System process/network/battery/audio diagnostics | Partially implemented | Agent `get_system_info` and Workspace diagnostics share one snapshot for uptime, load, system-volume capacity (`statfs`), primary display resolution/scale, adapter names/protocol families and Windows battery status from the native helper's `GetSystemPowerStatus` command. It omits IP/MAC addresses and display labels/bounds. Native helper compilation/protocol smoke returned a real typed battery response; no battery percentage is recorded. Process/audio-device diagnostics remain incomplete. |

## Wave 4 — productivity

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| Notes create/edit/search/project association | Partially implemented | Migration-backed project-scoped note CRUD is exposed to the agent; Notes & Planning supports browse/create/edit/delete plus Markdown/text import and Markdown export through main-process dialogs. Import limits type/size and rejects symlinks; export reads back saved content. Local document links now store canonical regular-file references, expose only display metadata to renderer, and verify the target again before opening. Store and UI tests pass; actual Windows dialog/open acceptance remains open. |
| Checklists/tasks persistent status and agent tools | Implemented, locally unit-verified; Windows acceptance open | Migration 9 adds project-owned checklists and task grouping; model tools can create/list checklists and create/list/update tasks within the active project. Workspace creates, filters and assigns checklists and edits task title/description/due date/status. |
| Local document linking and Markdown import/export | Partially implemented | Markdown/text import and export are implemented for notes. Migration 11 adds project-scoped links to supported regular local documents; renderer payload excludes absolute paths, and open revalidates the target. Store and UI bridge tests pass. Actual Windows file selection/open remains unverified, and general document authoring/export formats are still incomplete. |

## Wave 5 — workflows and specialists

| Deliverable | Initial status | Evidence / remaining work |
|---|---|---|
| User-initiated semantic workflow recording/replay | Partially implemented | A user can save completed verified task steps as a project-scoped draft; arguments become required inputs. Draft review supports edits saved as a new version before activation. Active tool-only skills can run once with validated declared inputs; task/audit records redact those exact values. Daily routine tool steps execute in stored order through the normal permission/executor path, gate actions on fresh observation, enforce reviewed approval flags, compare supported predicates against actual tool results, and stop on failure or unresolved postconditions. Daily schedules still exclude input-bearing skills and non-tool steps, and Windows UI acceptance remains open. |
| Routine execution status/history | Partially implemented | Local scheduling and run persistence exist; validate UI status and restart behavior. |
| Live specialist delegation | Partially implemented and integration-tested | The model can request bounded research, browser, systems, and knowledge subtasks. Delegates receive only declared tool schemas; child operations use the central scope/schema/permission gateway, cannot recursively delegate, and honor emergency stop. Tests cover capability exclusion, read-only execution and approval flow. Windows conversation acceptance and durable recovery remain unverified. |
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
| File organization and document summary | Partially implemented | Batch organization is unit-tested. Supported UTF-8 authoring uses `file_write`; generated binary document formats and a direct source-linked authoring workflow remain incomplete. |
| Website form workflow | Partially implemented | Playwright tools include semantic forms plus approved file upload/download. Cached Chromium fixture transfer tests pass; target-browser acceptance, remote site confirmation and Electron native dialog flows remain unverified. |
| Saved checklist, recorded workflow, specialist use | Partially implemented | Project checklists are persisted and editable; specialist use is connected and integration-tested; verified-task recording, editable versioned review, deterministic routine tool order, supported result predicates, observation/postcondition gates, and approval enforcement are implemented and covered by executor tests. Input-bearing replay and actual Windows acceptance remain open. |
| Offline transcription and neural speech | Blocked | Requires Python 3.12, downloaded model assets, audio/speaker device and Windows acceptance. |

## Wave 8 — release gate

| Gate | Initial status | Evidence / remaining work |
|---|---|---|
| GitHub Windows CI on audited SHA | Done and verified | Run [44882229282](https://github.com/cypskip-create/Pixel/actions/runs/44882229282) completed successfully on baseline `8288850`; no CI run covers these uncommitted changes. |
| Local typecheck/test/build repeat | Done and verified (local only) | Latest `npm run verify` passed both TypeScript projects, production build, and default Vitest **949 passed, 33 skipped, 0 failed (982 total; 73 files passed, 1 skipped)** with `PIXEL_TEST_HOME` under `%TEMP%`. `scripts/build-native.ps1 -OutputPath <temporary exe>` compiled and protocol-smoke-tested `ping` and the new native `system_power_status` command against Windows; its actual response values were not recorded. Cached Chromium separately passes **30** browser tests and **29** tool-policy tests. The renderer emits a 502.74 kB minified entry chunk, above Vite's advisory threshold. Loopback fixtures remain blocked by `ERR_NETWORK_ACCESS_DENIED`; no hosted CI covers this local tree. |
| Native/helper/voice tests | Done and verified in bounded local checks | Native helper compilation passed; Python worker tests 12/12 passed. These do not establish microphone inference or neural playback with real models. |
| Windows GUI and installer lifecycle | Blocked | This local `electron-builder --win --dir --publish never` attempt stopped on `github.com` DNS while fetching a packaging helper; pre-existing ignored release files were preserved. The new launcher resolves the occupied-port case, but latest Electron startup still exits `2147483651` (`0x80000003`) without a visible window on isolated APPDATA. Hosted packaging passed on baseline run 44882229282, but interactive launch, install/upgrade and data-preservation acceptance remain unverified. |
| Final capability matrix | In progress | Remaining gaps remain as documented; note-document linking, Plugin Manager UI, bundled update compatibility flow, binary text-write refusal, dev port selection, specialist integration, editable skill review, deterministic tool-plan execution, one-time declared inputs, observation/postcondition gates and browser transfers are covered by **949 passed, 33 skipped** default tests plus 30/30 opt-in cached-Chromium tests. Electron native dialog/open, live provider, visual and other Windows acceptance remain unverified. Do not set overall completion while required rows remain missing, blocked, or unverified. |

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
  full browser form/session/network acceptance, Windows file-dialog/open
  acceptance, persistent
  agent recovery, voice inference, or installed-app acceptance.
- Overall Core Tools status remains **in progress**.
