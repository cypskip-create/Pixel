# Pixel progress

Updated: 2026-11-22. Version: 0.2.1.

## New-chat recovery and current local checkpoint

- Recovery began at `8288850ac825d5b5c1b79656f1432622a8129bf7`; current
  committed HEAD and `origin/main` are `74f3973293992e3c44c5194f3f84b90f758d15f5`.
  The last confirmed Windows CI run,
  [44916016724](https://github.com/cypskip-create/Pixel/actions/runs/44916016724),
  passed on `0780c18d22ce1c07ba195527f952ac9cb9f7d37d`. GitHub returned no
  status records for `74f3973`, so CI for current HEAD is unverified. Current
  local edits are uncommitted and are not covered by that run.
- REA `6.10.1` remains registered and its Codex config/skill identity checks are
  healthy. `codex mcp list` historically labels it **enabled / Unsupported**,
  while this current Codex session exposes callable REA tools. A disposable
  JavaScript fixture analysis and captures of Inspora Folders, the ASCII Sharks
  gallery and its public GitHub repo succeeded; evidence IDs and hashes are in
  `docs/debug/REA_INTEGRATION.md` and
  `docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md`. The Ostrand screenshot was
  inspected as the user attachment. Packaged Pixel analysis timed out, and no
  live Pixel runtime was analyzed. Browser captures show accessible reference
  pages, not the original products' live application behavior.
- The latest Windows app inventory found two `Pixel` windows, both from the
  separate `C:\dev\Pixel` checkout. Computer Use could not read either
  accessibility tree; the windows were left untouched. No running window from
  this repository was identified, so its GUI acceptance remains open.
- Launch was retried after desktop access was approved. Main/preload and native
  helper builds succeeded; the dev server preserved the existing port 5199
  listener and moved to 5200, then Electron exited `2147483651`
  (`0x80000003`) without a window. A minimal isolated Electron smoke exited 0
  but emitted no ready marker, so it does not establish that the runtime works.
- Visual-preview follow-up: Vite started on `0.0.0.0:5200`, but local browser
  requests from the host sandbox were denied (`ERR_NETWORK_ACCESS_DENIED`) and
  the in-app browser timed out. A `file:` preview of the production renderer
  had blocked module assets and yielded a blank page; that capture was removed.
  The test server was stopped. No current-checkout UI evidence was produced.
- The Library empty state now has a real “Add folder” workflow. A native
  picker is followed by a confirmation that displays the selected path; only
  then does the main process index that directory into the active project.
  Renderer IPC receives counts/result text but no source path. Typecheck,
  focused document/Library tests and the production build passed; full Windows
  dialog acceptance remains open.
- Follow-up adds “Open original” from a ready Library preview. Main-process
  logic accepts a project document ID, rechecks indexed source freshness and an
  extension allowlist, then calls `shell.openPath`; paths never cross IPC.
  Stale/missing files, source-code formats and macro-enabled spreadsheets are
  refused. The type filter constrains both folder cards and file rows; an
  accessible card action menu opens a real indexed folder through a
  project-scoped ID, with path resolution and symlink checks kept in the main
  process. Focused document/Library suites pass **45 tests** with one
  symlink-creation skip; `npm run typecheck` and `npm run build` pass, with a
  458.31 kB renderer entry. Native open behavior remains unverified.
- Local source adds a centralized critical-risk policy, dynamic one-time risk
  for explicit browser submission, a bundled-only plugin lifecycle and UI, and
  a read-only public GitHub repository metadata tool. This uncommitted
  continuation adds migration-backed per-project plugin availability with a
  global enable ceiling, filtered tool registration, project-switch refresh,
  and revocation of persisted and in-memory grants plus pending approvals on
  scope changes, disable, update and uninstall. The plugin has fixture
  integration coverage, not live provider verification.
- Document indexing now uses `lstat` at the selected root and discovered
  entries, refusing symlink/junction traversal and filtering credential-like
  filenames. The regression test is skipped locally because this Windows
  sandbox denies symlink creation (`EPERM`).
- Added `documents_read`: the model can request bounded passage pages by an ID
  from the active project's document list. Results carry title/path/location,
  millisecond size/mtime signature checks reject ordinary detected stale files,
  and the system prompt requires citations to title and passage. A regression
  test detects same-size edits inside one second; metadata-restoring edits still
  require re-indexing to detect. Integration tests cover bounded pages, project
  isolation, untrusted-content labeling and stale-source refusal.
- `documents_search` now checks freshness for every matched source before
  returning cached FTS excerpts. Changed or unavailable sources are withheld
  with a re-index instruction; regression coverage edits a source without
  changing its size. This uses the same size/mtime freshness limit as reads.
- The GitHub plugin adds a manifest-declared `descriptionDetail` select,
  stored as a validated exact choice in SQLite, shown in the installed-plugin
  manager and applied before returning untrusted repository description text.
  Existing `1.0.0` installs require the reviewed update to `1.1.0` and remain
  disabled until re-enabled. This is a non-secret setting, not account auth.
- Final exact-tree `npm run verify` passes typecheck, production build and 74
  test files: **994 passed, 11 skipped, 0 failed** (1,005 total). All 30 real
  Chromium tests passed. It required a disposable temporary user profile:
  the initial default-profile run hit sandbox `EPERM` for fixtures under the
  real home folder. Skips remain seven missing-NSIS tests, three native
  foreground acceptance scenarios and the denied symlink fixture. The
  renderer entry is 458.39 kB.
- Electron GUI triage: this checkout rebuilt main/preload/native and launched
  Vite, but Electron again exited with `0x80000003` before Pixel's boot logger.
  Direct `electron.exe --version` produced the same exit for this binary and
  the read-only `C:\dev\Pixel` copy (same SHA-256); no Pixel window appeared in
  a fresh desktop inventory. Computer Use's explicit launch timed out. This
  narrows the blocker to the host Electron runtime before Pixel code; it does
  not identify the Windows cause or count as GUI acceptance. User app data was
  not modified.
- Latest `npm run verify`: typecheck and production build passed; the full
  suite reports **994 passed, 11 skipped, 0 failed** (1,005 total; 74 files
  passed, 1 skipped). `scripts/test.mjs` automatically selects the matching
  Chromium revision from `.pw-browsers` when present and respects an explicit
  `PLAYWRIGHT_BROWSERS_PATH`. All **30** live Chromium tests passed, including
  actual file-input selection and download hash read-back. Remaining skips are
  seven NSIS tests (`makensis` absent), three native foreground scenarios and
  the symlink fixture denied by the sandbox. Lazy-loaded secondary Workspace
  views reduce the renderer entry to 458.31 kB, below Vite's 500 kB advisory
  threshold. The latest plugin setting changes this entry to 458.39 kB.
- Agent `get_system_info` now consumes the same main-process diagnostics
  snapshot as Pixel's diagnostics view for uptime, load average, system-volume
  capacity through Node `statfs`, primary display dimensions/scale and battery
  state via a typed native `GetSystemPowerStatus` helper command. A disposable
  C# compile/protocol smoke returned a real response; no battery percentage was
  retained. The maintained native build script now validates the command too.
  Process and audio-device details remain open.
- Voice recheck: `VoiceService.capability()` reports `stt=false`, `tts=true`;
  direct System.Speech recognition failed because Windows has no recognizer
  installed. A temporary generated WAV and real Pixel Windows System.Speech
  playback succeeded (5,542 ms). The existing `small.en` weight file matches
  its pinned catalog SHA-256, but the host exposes Python 3.15.2 only, without
  `faster-whisper`, `kokoro_onnx` or `onnxruntime`; the inspected unpacked
  artifact has no packaged worker or Kokoro assets. Offline inference remains
  blocked.
- The renderer production bundle currently emits a 457.87 kB minified entry
  chunk, below Vite's advisory 500 kB threshold. Library, Plugins, Projects,
  Tasks, Notes and Board are emitted as dedicated lazy-loaded chunks. Actual
  Workspace startup remains unverified because this checkout's Electron launch
  exits before the app window appears.
- The supplied Ostrand screenshot was sampled at representative background,
  raised-surface and warm-orange chart pixels. The rounded palette is applied
  in shared CSS tokens; theme tests check token values and text contrast.
  Sample coordinates and chosen values are in
  `docs/architecture/PIXEL_DESIGN_TOKENS.md`.
- The standalone reviewed-skill replay path now applies the same input count,
  length and credential checks as the live IPC path. One-time values are
  redacted from observed results, callbacks, returned failures and propagated
  errors; focused skill/routine tests pass 17/17.
- The live GitHub adapter call for public `octocat/Hello-World` was retried and
  again stopped before HTTP because `api.github.com` DNS returned `ENOTFOUND`.
  The adapter now rechecks cancellation after DNS and validates every returned
  IP family/address before its pinned TLS request; focused plugin tests pass
  9/9, including unsupported API refusal and cancellation during DNS. The
  complete permission/executor path is fixture-tested, not
  live-provider verified.
- Tasks & Activity can record a completed verified task into a project skill
  draft; review edits create a new version. Scheduled routines now invoke the
  ordered reviewed tool plan directly, without model step selection. Current
  permission checks, reviewed approval floors, observation cadence, supported
  result/URL predicates, and postcondition gates apply. Parameterized and
  non-tool skill steps still cannot run as routines; broader predicates and
  actual Windows acceptance remain open.
- Core Tools 6.2 is not complete. Windows application launch, installed UI,
  clipboard, UIA, voice/model, packaged acceptance and multiple listed tool
  gaps remain blocked or unverified. See the maintained matrix and fresh
  checkpoint report rather than treating earlier results as current.
- The user supplied the Ostrand dashboard reference. A warm matte Workspace
  redesign, project grid/list and reduced-motion Pix ambient treatment are now
  present in the uncommitted source; actual Windows visual comparison remains
  blocked because only the separate `C:\dev\Pixel` checkout opened. See
  `docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md`.
- Note-to-local-document associations are now implemented with migration,
  scoped main-process IPC and UI; store tests cover de-duplication, project
  isolation, directory refusal and unlink. Windows dialog/open behavior remains
  unverified.
- The Plugin Manager is now a separate Workspace component with expandable
  permission disclosures, explicit connection state, update metadata, in-flight
  action locking and visible failure state. It now identifies version mismatch
  and offers a reviewed bundled update that leaves the plugin disabled until
  re-enabled. Five UI tests cover grouping, disclosures, duplicate clicks,
  failure handling and the compatibility/update behavior.
- The approved `file_write` path now explicitly refuses known binary document,
  media and archive extensions rather than writing UTF-8 bytes and reporting a
  corrupted PDF/Office file as success. Markdown, CSV and JSON creation/edit
  round trips are covered. Rich PDF/Office authoring and export remain open; see
  `docs/architecture/PIXEL_DOCUMENT_ASSISTANCE.md`.

## Core Completion 6.2 follow-on (local, uncommitted)

Rechecked GitHub `main` at
`64e0383484cfcbc35370c9f8aa2498f9428dd15d` (unchanged from the local base).
Latest Windows Actions run
[44869374637](https://github.com/cypskip-create/Pixel/actions/runs/44869374637)
passed on that exact commit, including NSIS setup, type checking, worker tests,
sandboxed preload smoke, full automated tests, native-helper compilation,
unpacked/portable/NSIS packaging and artifact upload. It predates the local
file-tool changes below.

- Extended `file_search` with validated minimum/maximum byte and ISO modified-
  time filters, preserving the existing bounded traversal, hidden/symlink
  exclusions and home-directory scope.
- Added approved `file_open` through main-process `shell.openPath` for folders
  and a fixed set of document/image formats. It refuses symlinks, executable or
  script formats and sensitive-name paths. Its verification is deliberately
  limited to Windows accepting the request and the path still existing; it does
  not claim the target window appeared.
- Added approval-gated `file_trash` through Electron `shell.trashItem`, limited
  to one home-scoped regular file. It rejects sensitive-name paths and verifies
  that the original path disappeared. Its unit test uses a deterministic
  adapter; actual Windows Recycle Bin behavior remains unverified.
- Browser tab create/list/switch/close tools are registered with the central
  schema and executor. Navigation remains behind `NetworkGuard`; live Chromium
  lifecycle tests are skipped because browser download fails DNS resolution.
- Migration 8 adds project-scoped notes/tasks with model-visible CRUD tools,
  verified SQLite read-back and a Workspace Notes & Planning page. The page
  supports note create/edit/delete, task create/complete, and Markdown/text
  import plus Markdown export through main-process dialogs. Import is capped at
  20 KB, accepts Markdown/text and rejects symlinks; export reads back the
  saved contents. Task descriptions and due dates can also be created/edited in
  Workspace; migration 9 adds project-scoped checklist grouping and task assignment.
- **Current local verification:** typecheck passed; Vitest **893 passed, 28
  skipped, 0 failed (921 total; 64 files passed, 1 skipped)**; production
  build passed; native helper build passed; Python worker tests **12/12**. The
  28 skips require Chromium, local NSIS, or an opt-in native foreground fixture.
- A local `npm run pack` rebuilt the renderer and native helper, then stopped in
  `build-voice-worker.ps1`: the Windows Python launcher reported “No suitable
  Python runtime found.” This machine lacks the pinned Python 3.12 runtime, so
  unpacked/portable/NSIS packaging was not produced for these edits.
- These changes are uncommitted and not covered by GitHub Actions. `npm run
  dev` is blocked by occupied port 5199 and Electron's pre-app exit
  `2147483651` (`0x80000003`); the sandbox smoke also exits before its report.
  The only visible Pixel windows belonged to another checkout. Real model calls,
  installed-app behavior and Windows GUI acceptance remain unverified. Overall
  Core Tools completion remains outstanding as recorded in the matrix below.

## Core Completion 6.2 clipboard and batch-file work (committed baseline)

This earlier work started from `e57f11ef4ec2e4b03c436ca68e6488459a2b6eee` and
is now included in main at `64e0383484cfcbc35370c9f8aa2498f9428dd15d`. No
release was published.

- **Hosted Windows CI:** the latest cited run
  [44786311339](https://github.com/cypskip-create/Pixel/actions/runs/44786311339)
  is green on that exact base SHA. TypeScript checks, worker tests, sandboxed
  preload smoke, full test step, native helper compilation, unpacked/portable/
  NSIS packaging, and artifact upload all completed. The uploaded artifact is
  [pixel-windows-ci-36.zip](https://github.com/cypskip-create/Pixel/actions/runs/44786311339/artifacts/14653789646).
  This is not interactive install or user-laptop acceptance, and it does not
  include the local uncommitted changes below.
- **Clipboard agent tools:** added strict main-process tools `clipboard_read`,
  `clipboard_copy`, `clipboard_restore`, and `clipboard_paste` to the existing
  registry and dispatcher. Reads/writes request explicit approval. Common
  credential-like strings are refused. Copy snapshots only a non-secret prior
  text value up to 20,000 characters in memory for five minutes; timed cleanup
  removes expired snapshots, and restore only occurs if clipboard still matches
  Pixel's last write. Emergency stop clears snapshots. `clipboard_paste` uses
  UI Automation `ValuePattern` on a specific verified control, so it replaces
  the field value and does not claim caret-position Ctrl+V. Read-triggered chat
  turns become session-only, and durable task output stores a generic summary
  rather than clipboard contents.
- **Batch file operations:** added `file_batch_copy`, `file_batch_rename` and
  `file_find_duplicates` to the existing home-scoped FileTools registry. Batches
  are limited to 20 explicit path pairs, no overwrite, credential-like paths
  are refused, copies are staged and hash-verified before move sources are
  removed, and partial removal failures report actual completed paths.
  Duplicate scans are bounded by entry, depth, file size and aggregate bytes;
  they never delete anything. Focused tests cover copy/move, hash duplicate
  matches and pre-mutation refusal.
- **Filtered discovery and open:** `file_search` now accepts bounded size and
  modified-time filters in addition to name/extension. Added approved `file_open`
  for home-scoped folders and supported documents/images through Electron's
  main-process `shell.openPath`; executable/script types and credential-like
  paths are refused. Its result reports OS acceptance and path existence, not
  that a visible application window was observed.
- **Tests/build:** current-worktree typecheck passed; full Vitest result is
  **877 passed, 27 skipped, 0 failed (904 total; 62 files passed, 1 skipped)**. Production renderer/main
  build passed. Native helper compiled. Python worker tests passed **12/12**.
  Skips are still Chromium-dependent browser cases, unavailable local NSIS
  integration cases, and opt-in foreground integration. The clipboard code has
  not yet run on a Windows clipboard through an installed Pixel GUI.
- **Local environment blockers:** `npm run setup:voice-dev` correctly refused
  because only Python 3.15 x64 is installed; Pixel's pinned worker requires
  Python 3.12 x64. It did not create a venv or modify model files. The local
  `npm run test:preload-sandbox` rebuilt the bundled preload/renderer but
  Electron exited `2147483651` (`0x80000003`) before the smoke report. Hosted
  preload smoke passed on the base SHA; this local launch failure is still
  unresolved and does not count as a successful local preload test.
- **Unfinished 6.1/6.2 scope:** offline STT inference and neural TTS playback
  with downloaded models, comparative speech benchmarks, document authoring,
  date/size file filters, file/folder opening, recycle/restore, browser tabs/uploads/downloads, editable
  desktop drawing, complete Pixel Board model workflows, richer diagnostics,
  user notes/checklists, live semantic workflow recording, live specialist
  delegation, generalized critical-risk policy, and real multi-step Windows
  acceptance remain partial, missing, or unverified. External plugins remain
  deferred. See the tracked [6.2 implementation checklist](docs/validation/PIXEL_CORE_TOOLS_6_2_CHECKLIST.md).
- **Windows GUI boundary:** this checkout did not get a successful interactive
  Pixel launch. The CUA inventory found Pixel windows only from a separate
  `C:\dev\Pixel` checkout. Settings navigation and current clipboard behavior
  therefore remain unverified on the user laptop.

## Core Tools 6.1 reliability audit and fixes

Reviewed latest GitHub `main` and local `HEAD`: `69106e8d9a40cacd49d2f2b2d228b06ca80585d3`.
The worktree was clean before this task. Changes are local and uncommitted;
there was no push, commit, or release. The latest Windows Actions run at review
was [run 44765517201](https://github.com/cypskip-create/Pixel/actions/runs/44765517201)
on this exact SHA and failed during NSIS setup before validation steps ran.

- **Settings return navigation:** Settings now remembers which Workspace view
  opened it. A visible, keyboard-operable “Back to Workspace” button returns to
  Chats, Projects, Tasks, Skills, Memory, Tools, or Pixel Board as applicable.
  Existing chat/project state stays mounted in Workspace; the chat transcript
  scroll offset is restored when returning. Settings microphone/voice-test
  resources are cancelled/released on unmount. Focused UI tests cover the
  return action and resource cleanup.
- **Windows CI root cause and source repair:** the failed run installed NSIS
  3.13 to `C:\Program Files (x86)\NSIS`, but the workflow broke out of its
  Chocolatey loop on exit code 0 without re-probing the standard install path.
  It therefore unnecessarily downloaded NSIS 3.11 and failed its pinned hash
  check (`a82799f1…` vs the expected digest). CI now searches known locations
  after Chocolatey completes, before the checksum-verified fallback. The
  fallback hash verification remains enabled. A regression test checks this
  order. This fix is not yet exercised by a hosted Actions run because the user
  commits and pushes changes themselves.
- **Voice setup diagnostic:** this machine has Python 3.15 x64, while the
  existing pinned voice runtime requires Python 3.12 x64; `.venv-voice-dev`
  and the frozen worker are absent. `npm run setup:voice-dev` was run and
  correctly refused to create an environment. Its launcher failure now
  identifies detected Python runtimes instead of surfacing an opaque `py`
  invocation exception. No model data was touched. No offline inference,
  benchmark, Kokoro playback, or voice-cloning acceptance is claimed.
- **Scoped persistent screen observation:** explicitly approving “Always
  Allow” for a selected window now persists a grant scoped to the exact process
  name and exact window title. The HWND and PID remain required and validated
  for each actual operation, but are omitted from the persisted identity so
  harmless process/window restarts do not force a repeat prompt. The grant
  applies only to screen reading, UIA discovery/verification, and passive
  annotations; UI invocation and typing are excluded. Screen observations and
  passive guidance are classified medium risk and still require an initial
  user decision. Grants without a verified process name/title are ineligible.
  Tests cover reuse after restart, changed HWND/PID, title mismatch, and the
  fact that the grant does not authorize UI actions.
- **Follow-up validation after permission-policy change:** full Vitest suite
  **868 passed, 0 failed, 27 skipped (895 total; 61 files passed, 1 skipped)**;
  skips remain 17 missing-Chromium browser cases, 7 missing-NSIS cases, and 3
  opt-in Windows foreground integration cases. Production build passed.
- **Open-source research:** added
  [`PIXEL_CORE_TOOLS_6_1_RESEARCH.md`](docs/research/PIXEL_CORE_TOOLS_6_1_RESEARCH.md)
  with upstream source revisions, code-license findings and model/voice license
  boundaries for the requested speech and AppFlowy projects. Source clones
  could not be fetched because outbound DNS/network access is blocked. No
  third-party code, engine, model, or external account plugin was added.
- **Automated validation:** `npm run typecheck` passed; `npm run build` passed;
  Vitest passed **866, failed 0, skipped 27 (893 total; 61 files passed, 1
  skipped)**; Python worker tests passed **12/12**; native UIA helper compiled
  and its ping protocol smoke completed. The existing sandboxed Electron
  preload test still exits `2147483651` (`0x80000003`) before writing a result.
  The NSIS integration group skips 7 cases because `makensis` is absent; 17
  browser cases skip because Chromium download failed with `ENOTFOUND
  cdn.playwright.dev`; 3 foreground integration cases are skipped unless the
  native Windows fixture is enabled.
- **Windows GUI boundary:** `npm run dev` reports Vite port 5199 already in
  use, though no listening process was returned by `netstat`/`Get-NetTCPConnection`.
  Vite ran on alternate port 5299, but the Electron process exited with code 1
  before a Pixel window appeared. The packaged Electron launch also exited 1
  without a window. Therefore Settings visual navigation, startup, speech,
  Board workflows, installer, UIA and laptop acceptance remain unverified.

The pre-existing capability status matrix remains in
[`PIXEL_CORE_TOOLS_6_AUDIT.md`](docs/validation/PIXEL_CORE_TOOLS_6_AUDIT.md).
Core gaps are still real: clipboard agent tools, editable desktop drawing,
complete document authoring, live semantic workflow recording/replay, live
specialist delegation, broad system diagnostics, general critical-risk policy,
and verified model-backed Windows acceptance are not complete. These are not
reported as implemented by this checkpoint.

## Core Tools 6.0 regression audit and focused repairs

Reviewed latest local `main` base: `d538c1044c9f6c4a0e7edc8073877436cae8dc4f`.
All work in this section is local and uncommitted; no commit, push, or CI run
was created.

- **Pix placement:** removed Pix from the Workspace conversation header, empty
  state, historical assistant messages, streaming messages, and response and
  transcript surfaces. Exactly the composer pet remains in Workspace; the
  Dynamic Island retains its separately state-driven Pix.
- **Pix activity and state priority:** replaced the one-off play boolean with
  a bounded idle behavior scheduler for looking, sitting, lying, sleeping,
  waking, stretching, walking, exploring, ball play, jumping, waving, thinking,
  and resting. It cancels for live assistant work, reduced motion, hidden
  documents and unmount; input wakes sleeping Pix. Shared assistant-state
  priority now puts stop/error/approval/listening/speaking/working ahead of
  idle activity and honors errors before pending approval.
- **Tool catalog:** file and document tools now use distinct categories. The
  Tools page groups registered capabilities, shows approval/state-change
  behavior, reports the Windows UIA helper and Python document runtime when
  checked, marks Playwright as checked on first use, and lists known partial
  and unavailable capability families without presenting them as ready.
- **Windows CI recovery:** the failed run
  [`44603748589`](https://github.com/cypskip-create/Pixel/actions/runs/44603748589)
  failed after Chocolatey’s NSIS feed returned HTTP 503 and `makensis` was
  absent. Windows CI now checks standard runner locations, retries Chocolatey
  three times with bounded backoff, then verifies the official NSIS 3.11
  installer against a pinned SHA-256 before fallback installation. The YAML
  and PowerShell step parse locally; the fallback and a new hosted workflow
  have not run.
- **Capability audit:**
  [`PIXEL_CORE_TOOLS_6_AUDIT.md`](docs/validation/PIXEL_CORE_TOOLS_6_AUDIT.md)
  records code-tested, partial, missing, and Windows-unverified capabilities.
  Board tools are in the model schema and dispatcher and have service/agent
  tests; no live DeepSeek diagram run was available. Desktop drawing remains
  passive verified-control guidance, not a freehand editor. Clipboard tools,
  live workflow recording, broad diagnostics, and live specialist delegation
  remain missing or partial as detailed in that matrix.
- **Validation:** `npm run typecheck` passed; `npm run build` passed; full
  Vitest **862 passed, 0 failed, 27 skipped (889 total; 61 test files passed,
  1 skipped)**; Python worker tests **12/12 passed**; `npm run build:native`
  compiled PixelNative and completed its protocol smoke. `git diff --check`,
  workflow YAML parsing, and PowerShell AST parsing passed. Browser tests
  skipped because Playwright Chromium is absent; NSIS tests skipped because
  `makensis` is absent. The sandboxed Electron preload smoke exited with
  `2147483651` (`0x80000003`) before writing its report. `npm run dev` could
  not bind the fixed Vite port 5199. Therefore no Windows GUI, packaged app,
  installer, visual screenshot, live UIA, TTS/STT, or end-to-end agent acceptance
  is claimed. Latest supplied Windows Actions evidence remains the failed
  NSIS-provisioning run; these local changes are not CI-verified.

## Follow-up — voice setup, composer Pix and navigation consolidation

Reviewed current `main`: `8ed850fbb3b2f1d550e7f246d916a99491da3fc9`.
The latest verified Windows workflow is
[`44593414322`](https://github.com/cypskip-create/Pixel/actions/runs/44593414322)
on parent commit `3897a2a`; no run exists for these local edits.
The development app had been pinned to `.venv-voice-build`, the
packaging-only environment, while the documented user checks confirmed that
environment and the frozen worker did not exist. Development now has a
separate, explicit `npm run setup:voice-dev` setup and uses
`.venv-voice-dev`; setup installs pinned speech dependencies only after the
user runs it, checks CTranslate2/ONNX and worker protocol, and can verify the
selected model plus a real inference when `-ModelPath`/`-AudioPath` are
provided. A missing faster-whisper runtime now reports the actionable setup
command instead of asking to reinstall a development checkout. This has not
yet been run on the target laptop, and no downloaded model or inference result
is claimed here. Fixed setup's interpreter override to use the development-only
`PIXEL_VOICE_DEV_PYTHON` variable; it no longer points users at the packaging
environment variable.

Workspace now includes a small Pix beside the composer. It idles with the
existing expression system, occasionally explores within a fixed 25 px lane
and briefly rolls a small ball. Assistant activity, reduced motion and hidden
documents stop idle play. Native screenshot comparison and Windows timing are
not yet verified. The redundant app icon rail has been removed so the
expandable Workspace sidebar is the single navigation source; the header
emergency-stop control remains. A packaging-only interpreter variable typo in
the voice setup diagnostic is corrected to `PIXEL_VOICE_DEV_PYTHON`.
Validation on this follow-up: typecheck and production build passed; full Vitest
**858 passed, 0 failed, 27 skipped (885 total; 61 files passed, 1 skipped)**;
Workspace control tests passed **8/8**. Browser and NSIS tests skipped because
Playwright Chromium and `makensis` are unavailable. The setup diagnostic now
identifies the development override on an invalid-path check. Actual dependency
installation, local model inference, live Windows UI and previous feature
acceptance remain unverified. The latest Windows workflow is green on its
parent commit only; no commit or push was made.

## Current local checkpoint — Experience 5.2 Board agent and Workspace

Reviewed GitHub `main`: `d98fbe896c4893fadc506b7fd0783e570dfbd3f8` (latest as of
2026-11-19). Windows CI run
[`44567448710`](https://github.com/cypskip-create/Pixel/actions/runs/44567448710)
completed successfully on parent release commit
`0a8f39f68bf54bc10ac3274521ef348b8289080a`. The changes below are local and
uncommitted; no push or workflow run was created.

- Pixel Board is now owned by `PixelBoardService` in the main process. It
  persists revisioned documents under the Pixel user-data directory, imports
  the previous local draft without deleting it, validates all objects, groups
  edits for undo/redo, and prevents stale revisions from overwriting newer
  renderer/agent edits.
- Agent-visible Board tools are registered in the same schema, policy and
  executor pipeline as the other tools: `board_get_state`, `board_create`,
  `board_add_text`, `board_add_shape`, `board_add_stroke`, `board_add_marker`,
  `board_create_diagram`, `board_update_object`, `board_delete_object`,
  `board_clear`, `board_undo`, `board_redo`, `board_open`, `board_save` and
  `board_export`. Diagram creation is one undoable operation; the tool result
  includes a verified main-process snapshot. Open/save/export use main-process
  file dialogs and explicit overwrite/replacement confirmation. Agent export
  currently supports editable `.pixelboard` and SVG.
- Added exact-window `screen_draw_arrow`. It locates one accessible UIA control
  in the approved window and displays a passive arrow using only verified UIA
  bounds. It never clicks or focuses the target. Existing rectangle/circle/
  arrow highlight guidance remains available. Arbitrary freehand desktop
  drawing, editable desktop overlays and desktop export are not implemented.
- Agent-mode screen authorization can be granted for one exact selected window
  for the current app session. That volatile grant covers only screen
  observation and passive UIA guidance on the same window identity; it does not
  authorize clicks or typing and is revoked/expired independently. Read-only
  foreground metadata no longer prompts. Persistent Always Allow remains
  limited to the existing app-launch and HTTPS-origin allowlists.
- The Workspace now has a separate narrow section rail beside the recent-chat
  sidebar. Settings replaces the chat sidebar with its own category navigation.
  User messages use right-aligned blue bubbles (`#214D90`), assistant replies
  remain unboxed, and the shared dark palette matches the supplied charcoal
  references. The Settings page now has a visible General/Voice/Privacy/Tools
  heading and grouped content. Pix keeps its independent mint artwork.
- Cursor Buddy remains separate from Pix and now has a compact rounded
  rectangle with its own small cursor nib. The nib is the anchor used by
  bounded screen-edge placement; this remains a code-level change until a
  visible Windows test confirms its appearance.
- Validation on this worktree: `npm run typecheck`, `npm run build:native`,
  and `npm run build` passed; `npm test --
  --reporter=dot` passed with **856 passed, 0 failed, 27 skipped (883 total;
  60 files passed, 1 skipped)**; and `npm run build` passed. The tests ran with
  an isolated `USERPROFILE` under `.pixel-test-profile` so tests could not
  write into the real Windows profile. Browser tests skipped because Playwright
  Chromium is unavailable; NSIS tests skipped because `makensis` is unavailable.
  The supplied Actions run is green on the parent commit, not these local
  changes. Windows UI launch was attempted: `npm run dev` stopped because Vite
  reported its strict port 5199 was occupied; launching the built Electron app
  with isolated user-data paths exited with code 1 without a window or useful
  log. The desktop UI, external-window annotation, save/reopen dialogs, screenshot
  comparison and pointer-follow behavior therefore remain unverified.

## Current fix — Cursor Buddy stays hidden after being enabled

Reviewed latest GitHub `main`: `0a8f39f68bf54bc10ac3274521ef348b8289080a`.
The fix below is local and uncommitted; no push or workflow was triggered.

- Root cause from the laptop log: the shared IPC guard trusted Island, Settings
  and Workspace renderers but excluded the cursor window. As a result,
  `window:cursorRendererReady` was rejected and the 8-second readiness timer
  left the buddy hidden. The cursor renderer also called the broad
  `settings:get` endpoint, which was rejected for the same reason.
- The cursor now has a two-channel IPC allowlist: renderer-ready and a new
  reduced-motion-only preference read. Sender checks require the current
  cursor BrowserWindow, its main frame and Pixel's trusted renderer URL. All
  other IPC remains denied for the cursor window. Popup and cross-document
  navigation are blocked there as well.
- Validation on this host: typecheck and production build passed; focused
  cursor IPC policy tests **6/6 passed**; full Vitest **842 passed, 27 skipped,
  0 failed (869 total; 57 files passed, 1 skipped)**. The current GitHub commit
  has no reported status checks; no CI run was started for this local change.
  The sandbox preload smoke rebuilt the new API but Electron exited
  `2147483651` (`0x80000003`) before producing a renderer report.
  The user's photo is pre-fix runtime evidence; post-fix real-laptop visibility
  is not yet confirmed.

## Latest merged checkpoint — Experience 5.1 & Tools 5.2

Reviewed source base: `47d1db1284c7860ec52ddf1f6dd50bf532a2f8b4` on `main`.
This checkpoint is on latest `main` as `0a8f39f68bf54bc10ac3274521ef348b8289080a`;
no release was published.

- The failed Windows CI run `44542308139` passed JSONL framing and failed in
  frozen voice runtime initialization. Source inspection found phonemizer was
  not explicitly configured for the packaged eSpeak NG library/data from
  `espeakng-loader`, a plausible cause that still needs confirmation against a
  frozen Windows binary. The worker now configures those paths and retains the
  DLL search handle; failure reports name the initialization stage and redact
  absolute paths. Local unit coverage verifies configuration and diagnostics.
  A Python 3.12 frozen build and a new GitHub run are still required to confirm
  the native dependency repair.
  The [Windows CI #29 run](https://github.com/cypskip-create/Pixel/actions/runs/44542308139)
  is on this exact base SHA. Steps through native-helper compilation passed;
  unpacked/portable/NSIS packaging failed, then the workflow uploaded its log
  and test artifact. The log reports only generic `RUNTIME_SMOKE_FAILED` /
  `RuntimeError`, not the exact failing native import or call.
- Global Settings/Workspace interaction tokens now use a neutral charcoal
  palette with blue controls (`#4299F5`, hover `#60A9FA`). Pix’s approved mint
  colors are separate. Workspace Settings now has General, Voice, Privacy &
  Memory, and Tools & Integrations pages. Mode selection, checked controls,
  primary permission action and focus states use blue; Settings keeps the
  neutral selected row with a restrained blue icon/edge indicator.
- The compact Island assistant identity uses Pix while the P stays in the
  Pixel brand lockup. Companion state now incorporates terminal task success
  or failure briefly and allows current streaming/voice activity to override a
  prior task outcome.
- TTS playback state is now owned by the main-process voice service and
  broadcast to Island, Workspace and Settings renderers through typed,
  narrow preload methods. This lets Pix speak in every app surface during
  actual playback; the initial-state query cannot overwrite a newer live
  playback event. The focused hook test passes. Actual audio/UI timing remains
  unverified in the desktop application.
- Pixel Board adds an editable in-Workspace SVG scene with pen, highlighter,
  line, arrow, rectangle, circle, text, numbered markers, selection/move,
  erase, undo/redo, local draft recovery, `.pixelboard` import/export and
  user-triggered SVG/PNG export. This is not the requested desktop overlay:
  the native guidance overlay stays click-through, and cross-app persistent
  drawing, PDF export, screenshot insertion and coordinate mouse input remain
  unimplemented.
- The requested critical-risk policy and one-switch per-task screen observation
  authorization are not implemented. Existing per-tool approval, grants,
  target verification, input lease and emergency-stop behavior remain in force.
- Conversation transcript avatars now use still Pix artwork for history and
  the real current assistant expression for an active response.
- The Workspace Settings category selection now persists across visits where
  renderer local storage is available; the selected row uses a neutral fill
  with a blue icon and edge marker.
- Final changed-code validation on this host: `npm run typecheck` passed;
  `npm test -- --reporter=dot` passed **839 tests, skipped 27, failed 0
  (866 total; 57 files passed, 1 skipped)**; `npm run test:voice-worker`
  passed **12/12**; `npm run build:native` compiled and ran its protocol smoke;
  `npm run build` passed.
- `npm run test:preload-sandbox` failed before writing its report: Electron
  exited `2147483651` (`0x80000003`) on a repeat run after rebuilding the
  current bundle. `npm run build:voice-worker` could not
  run because the `py` launcher has no Python 3.12 runtime. Therefore no
  frozen-worker test, packaged app, installer, laptop screenshot or new
  Actions run is claimed.

### Experience 5.1 Validation

The failed run `44542308139` remains the latest available CI evidence; no
workflow was triggered because the user will commit and push. The desktop
Settings, Pix animation, Island, and Pixel Board were not screenshot-tested in
this run. Pixel Board is an in-Workspace editable vector canvas, not a desktop
overlay. Four-tier critical-risk policy, reduced repeated Agent approvals,
per-task screen-observation authorization, cross-app annotation, screenshot
insertion, PDF export and coordinate pointer actions remain unimplemented.
See [`docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md`](docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md)
for the evidence table and exact laptop commands.

## Previous checkpoint — Experience Polish 5.0 and official Pix (historical)

Reviewed base: `6ac637e2149872e112b78177b3dcda41c2c8c764` on
`codex/interaction-engine-3`. Working changes are uncommitted; the user will
commit and push. No release was published.

- Fixed the frozen voice-worker smoke boundary by replacing PowerShell string
  piping with a Node JSONL harness that writes explicit UTF-8 bytes without a
  BOM, captures stdout and stderr separately, validates response IDs/version
  and capability shape, and enforces a bounded timeout. The prior Actions run
  `44522917967` failed only at packaging when the frozen worker returned
  `BAD_JSON` before receiving a valid request. The new frozen-worker harness
  could not be exercised locally because Python 3.12 x64 and NSIS are absent;
  there is no Actions run for these unpushed changes, so CI is **not verified
  green**.
- Added canonical `PixMascot` SVG artwork based on the approved reference:
  silver rounded shell, dark display, folded mint corner, mint expressions,
  arms and feet. It is used in the Workspace header, empty conversation,
  active assistant and compact expanded-Island response. Historic messages
  use static avatars. Settings provides an expression preview. Pix remains
  separate from the pointer-shaped Cursor Buddy.
- Added a bounded, visibility-aware idle blink scheduler and state expressions
  driven by the existing assistant states. Reduced motion and document
  visibility pause animation. Success/failure status follows task evidence;
  results with unresolved verification are shown as needing attention.
- Cursor Buddy now has a dedicated preview and is no longer hidden merely
  because Workspace is open or the Island is expanded. A renderer-ready
  acknowledgement and bounded readiness diagnostics replace the unreliable
  assumption that `ready-to-show` always fires. The native companion remains
  independent from Pix. Actual Electron visibility/click-through/focus
  behavior still needs laptop validation.
- Settings switches use accessible `role="switch"`, checked semantics,
  keyboard support, visible focus, and distinct sage-enabled/charcoal-disabled
  states. The interface retains its charcoal foundation; mint is also used
  within Pix as specified by its character artwork.
- Added a bounded home-scoped file search, metadata, one-level directory
  creation, verified copy and verified rename to the existing permissioned
  filesystem toolset. These operations stay under the user's home directory,
  do not overwrite, skip hidden/sensitive/symlink entries and require scoped
  approval. Clipboard workflows and broader new application orchestration
  were not added; existing app, browser and document tools are unchanged.
- Validation on 2026-11-19: `npm run typecheck` passed; production
  `npm run build` passed; final full Vitest **834 passed, 27 skipped, 0 failed
  (861 total; 54 passed files, 1 skipped)**; Python worker tests **11/11**;
  native helper build/protocol ping passed; harmless WinForms UIA fixture
  passed and wrote
  `artifacts/windows-acceptance/pixel-native-uia-e2e-2026-11-19T13-45-14-496Z.json`.
  The native UIA harness is not evidence of the Pixel approval-card UI.
- `npm run test:preload-sandbox` exited `2147483651` without smoke output.
  Electron dev GUI, real Pix/cursor screenshots, the 1366×768 / 1920×1080 and
  100% / 125% visual matrix, GPU behavior and unpacked/portable/NSIS packages
  are unverified. Port 5199 was already occupied by another checkout; that
  launch attempt was not treated as an application failure. Chromium install
  was blocked by DNS (`ENOTFOUND cdn.playwright.dev`); Python 3.12 x64 and
  `makensis` are unavailable here.

See [`docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md`](docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md)
for exact evidence, remaining defects and laptop-side validation commands.

## Previous checkpoint — Tools 4.2 memory, persistent permissions and UI Automation

Updated: 2026-11-19. Branch: `codex/interaction-engine-3`. Local HEAD before
this uncommitted checkpoint: `cbac143ec28b0b19669aa58a911b5f53af0f5b5e`.
Changes remain uncommitted for the user to review and commit; no checkpoint
commit, push or release was made.

- Automatic Memory defaults on, can be disabled in Settings, and saves a small
  deterministic set of direct user preferences/project assertions without a
  permission prompt. It excludes common credentials, copied page/document
  instructions, injection-like text and oversized candidates. The main process
  also stores concise outcomes only for completed tasks with verified steps.
  Preference slots suppress near duplicates and record corrections in memory
  revision history. Explicit corrections and scoped forget commands still work
  when automatic capture is disabled. Memory is project-scoped, bounded to 250
  automatic entries per project, searchable, editable, exportable and deletable.
  General milestone/plan extraction, cross-project/global preferences and
  source-aware external fact capture remain limited or unimplemented.
- Permission cards now offer **Always Allow**, **Allow Once** and **Deny**.
  Always Allow is available only for exact allow-listed app launches (Notepad,
  Calculator, Paint) and an HTTPS browser origin. Grants persist in SQLite with
  the target scope, risk, policy version, timestamps and revocation state;
  startup revalidates them, and Settings lists/revokes them. High-risk and
  unscoped operations remain one-time approvals. Emergency Stop revokes saved
  grants and cancels pending work. The permission interface and backend are
  unit-tested; actual on-screen card interaction has not been verified in the
  Electron GUI in this environment.
- UI Automation now has ValuePattern entry/read-back, plus select, toggle,
  scroll and expand/collapse patterns with exact selector, enabled/visible and
  process/window identity checks. Input actions keep the desktop-input lease
  until helper termination is confirmed. High-risk actions require a fresh
  approval and return verified state read-back. A harmless WinForms fixture was
  added. Earlier real desktop attempts found controls and verified ValuePattern
  entry, but UIA provider calls failed and the task stayed blocked. The latest
  repeated runs passed text read-back, InvokePattern, separate
  postcondition verification, TogglePattern desired-state read-back, and
  durable task reload with 3 verification records and 61 task events. Its
  latest report is `artifacts/windows-acceptance/pixel-native-uia-e2e-2026-11-19T12-11-25-948Z.json`.
  Direct and documented `npm run test:native-uia-fixture` commands exited 0
  after the cleanup fix confirmed helper/fixture termination. Pixel's actual
  approval UI remains unverified. See
  `docs/validation/PIXEL_TOOLS_4_2_UIA_FIXTURE_RESULT.md`.
- Automatic task-outcome capture now rejects completed task records that have
  any failed step, unresolved verification, or no verified step. The fixture
  reported a completed task response despite failed controls; this additional
  gate prevents that partial result from being saved as a durable project
  outcome.
- Focused suite: **172/172 passed** across 7 files. Final full suite:
  **815 passed, 27 skipped, 0 failed (842 total)** across 52 passed files and
  1 skipped file. Skips: 17 Chromium cases (Playwright browser missing), 7 NSIS
  tests (`makensis` missing), and 3 opt-in native desktop tests. Final
  typecheck, production build, native helper compilation and protocol ping
  passed. Voice worker unit tests passed **11/11**.
- Latest reviewed main in the brief: `f607621bdc2fe9503df722f410423f630c700db2`.
  GitHub Actions run `44498305105` passed typecheck, worker unit tests, preload
  smoke, full automated tests and native-helper compilation, then failed in
  packaging at the pre-existing Voice 4.1 packaged worker protocol smoke:
  `BAD_JSON` / “Expecting value: line 1 column 1” before a JSON request was
  read. The packaging script was adjusted in this work to write explicit UTF-8
  request bytes, but the packaged Python 3.12 runtime has not yet been rebuilt
  to verify that fix. No new CI run exists for unpushed changes.

See [`docs/architecture/PIXEL_MEMORY.md`](docs/architecture/PIXEL_MEMORY.md),
[`docs/architecture/PIXEL_SECURITY_MODEL.md`](docs/architecture/PIXEL_SECURITY_MODEL.md),
[`docs/architecture/PIXEL_SCREEN_INTELLIGENCE.md`](docs/architecture/PIXEL_SCREEN_INTELLIGENCE.md),
and [`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md)
for implementation detail and exact laptop validation steps.

## Current checkpoint — Voice Engine 4.1 reliability and diagnostics

Updated: 2026-11-19. Branch: `codex/interaction-engine-3`. Base commit:
`d6031d9c0909413622b082fe9b8035a2acac01ba`. Changes are uncommitted for the
user to review and commit; no checkpoint commit, push or release was made.

- Fixed the PowerShell 5.1 Python-version probe, added an explicit CI Python
  interpreter and a post-freeze worker protocol/native-import smoke test.
- Replaced MediaRecorder/Opus decode capture with AudioWorklet direct PCM,
  bounded manual dictation at 120 seconds (PTT remains at 20 seconds), and
  added opt-in signal diagnostics plus a no-submit voice test and optional
  30-second WAV export through the native save dialog.
- Added Fast/Balanced/High accuracy model-size labels, real backend/model/time
  reporting after inference, long Kokoro text segmentation, test-voice timing,
  and an aggregate-only local accuracy benchmark harness. Recognition decoding
  defaults remain unchanged pending real corpus results.
- Validation: typecheck passed; full Vitest **801 passed, 0 failed, 27 skipped
  (828 total; 50 files passed, 1 skipped)**; Python tests **11 passed**;
  Python compileall and `npm run build` passed. Playwright browser download
  failed because DNS for `cdn.playwright.dev` is blocked. Electron's sandbox
  smoke exited `2147483651` before app/preload output. Python 3.15 rejection
  check passed before creating a build venv.
- The Python 3.12 x64 voice worker and unpacked/portable/NSIS packages were not
  built. The prior GitHub run `44485597153` failed on the PowerShell quoting
  defect repaired here; no new Actions run exists until these local edits are
  pushed. No real microphone, Whisper/Kokoro model, TTS playback/quality or
  accuracy benchmark was run. See [`docs/validation/PIXEL_VOICE_READINESS.md`](docs/validation/PIXEL_VOICE_READINESS.md)
  and [`docs/validation/PIXEL_VOICE_ACCEPTANCE.md`](docs/validation/PIXEL_VOICE_ACCEPTANCE.md)
  for evidence, limits and exact laptop steps.

Sections below describe earlier checkpoints; their HEADs and test totals are
historical and do not describe this current working tree.

## Previous checkpoint — Tools 4.1 screen intelligence and visual guidance

Updated: 2026-11-19. Branch: `codex/interaction-engine-3`. Local HEAD:
`ea110700e37173b2a88708bf617b2b17dbeed9bf`. The working tree contains the
uncommitted implementation below; no commit or push was made. The current
Windows desktop was exercised, but Pixel's foreground capture integration did
not pass in this environment, so no real app/overlay acceptance is claimed.

- Replaced Electron source-order guessing for active-window screenshots with
  the native helper's exact observed window identity and a bounded in-memory
  `PrintWindow` capture. Captures revalidate process/window identity and can
  fail closed. Added explicit last-external and selected-window capture paths.
- Display and region captures correlate only by Electron display ID. Regions
  use global virtual-desktop DIP, support negative monitor positions and
  clipping, reject cross-monitor/outside selections, and discard captures if
  display geometry or scale changes while capture is in flight.
- Successful captures include a fresh ID/time, target, bounds, display and
  scale metadata, measured image dimensions and an explicit uncached status.
  Empty vision output and capture failures are returned as failures; vision
  text is labeled model-inferred rather than UI Automation verified.
- Added a separate sandboxed transparent guidance window, kept mouse-click
  through and focusless. It can show a short-lived rectangle, circle, arrow,
  label or step number only around one exact UI Automation control. It
  revalidates target identity, element bounds and foreground state while
  visible; it expires, clears on stale targets, session lock and emergency
  stop, and never clicks or types.
- Added target enumeration/capture and narrowly scoped guidance IPC. React is
  not given native handles, raw IPC, or window-creation capability. The
  existing `analyze_screen`, UIA and permission paths are reused.
- `npm run typecheck`: passed. Focused screen/agent/guidance suite:
  **31/31 passed**. Full suite: **782 passed, 0 failed, 27 skipped (809 total;
  48 files passed, 1 skipped)**. The skips are 17 browser cases (Chromium is
  not installed in this host), 7 NSIS cases (`makensis` is unavailable), and
  3 opt-in native foreground integration cases.
- `npm run build`: passed (main TypeScript, bundled sandbox preload, renderer
  and icon). `npm run build:native`: passed; the C# helper compiled and its
  protocol smoke command succeeded. `git diff --check`: passed after the
  documentation update.
- `npm run test:native-foreground -- --reporter=dot`: **failed 3/3** both
  before and after focusing a harmless blank Notepad fixture. Each failed
  because the helper reported `The observed window or process is no longer
  available.` No native screenshot bytes, Pixel GUI or annotation was
  verified. Investigate on the target laptop with the exact commands in the
  Windows acceptance procedure before treating the feature as release-ready.
- Playwright Chromium and NSIS were not installed; browser and installer test
  outcomes are therefore skipped, not passed. `npm run dev` is also not
  accepted as a GUI pass: this host has a process already using Vite port
  5199, and the Electron child previously exited `2147483651` (`0x80000003`)
  before Pixel startup. Packaged GPU/renderer-child-process failures remain a
  separate unresolved diagnosis.

See [`docs/architecture/PIXEL_SCREEN_INTELLIGENCE.md`](docs/architecture/PIXEL_SCREEN_INTELLIGENCE.md)
and [`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md)
for implementation boundaries, exact commands and the target-laptop procedure.

## Previous checkpoint — Monochrome design and cursor companion repair

Branch: `codex/interaction-engine-3`. Current local HEAD: `7f10c058c70545f760923eb5b01b5da7764ca773`. Its tree (`9ff6f70cd0b0dd92cfb22d50e89c7d6168460cf5`) matches latest reviewed `main` commit `fce3128f42dd540e15f85c13a300105727784e02` before these local edits. This checkpoint is implemented in the working tree and remains uncommitted; the user will commit and push. No files, settings, history or credentials were reset.

- Replaced the renderer's navy/chromatic palette with the black/charcoal semantic system in `src/renderer/index.css`: app `#0D0D0D`, sidebar `#141414`, panel `#1B1B1B`, raised `#222222`, hover `#292929`, selected `#303030`, border `#333333`, text `#F4F4F4`/`#B8B8B8`/`#888888`, and brand/icon `#D4D4D4`. Approval, error, success, recording and working tokens are grayscale; their labels and icons remain explicit. The light theme stays grayscale. Workspace palette names now alias shared tokens.
- Replaced the previous glass tokens (`rgb(13 17 28 / .88)`, `rgb(22 28 43 / .95)`, `rgb(20 26 40 / .97)`) and Workspace values (`#151c28`, `#1c2635`, `#243144`, `#2c3b51`, `#49c5de`) with opaque neutral fills. No Acrylic, Mica, backdrop blur or decorative gradient was added. The transparent native frame remains for shaped edges.
- Preserved the approved P geometry in `src/shared/pixelMark.json`; `PixelMark.tsx` uses semantic monochrome foreground tokens for the in-app rendering. The workspace character and cursor character retain their original roles and silhouettes, now in grayscale.
- Reduced the cursor companion from a 64×64 DIP native window with a 54×54 SVG on a 64-unit viewBox to a 36×36 DIP window with a 28×28 SVG on a 32-unit viewBox. Placement now aligns the SVG pointer tip (hotspot) with the configured cursor-relative offset, capped to a 12 DIP radial gap. A critically damped follower has a 12 DIP position bound; large pointer jumps (160 DIP), monitor changes, reduced motion and resumes after 500 ms snap to the current target.
- The cursor companion is shown only for enabled, visible, idle Island state. It hides and stops its timer while the Island is expanded, Settings/Workspace is visible, Pixel is hidden, the session is locked or the setting is disabled. On reappearance it snaps near the current pointer. Its native window remains non-focusable and click-through. It reads pointer position only while enabled and visible; it does not capture screenshots or persist pointer movement.
- Updated cursor lifecycle, edge/hotspot, bounded-motion, settings migration and grayscale regression tests. The architecture regression now checks the shared palette aliases; preload-bundle build tests use a bounded 15-second timeout in isolated workers.
- `npm run typecheck`: passed.
- `npm test -- --reporter=dot`: **789 passed, 0 failed, 2 skipped (791 total; 46 files passed, 1 skipped)**. This run had local Playwright fixture access. The 2 skips are the opt-in real-desktop foreground integration cases. Separate elevated NSIS run: **9/9 passed**.
- `npm run build`: passed (main TypeScript, bundled sandbox preload, Vite renderer and icon generation). `npm run build:native`: passed; `PixelNative.exe` compiled and the build script's protocol smoke exited successfully.
- `npm run test:preload-sandbox`: **unverified/blocked in this host**. Electron 45.2.3 exits `2147483651` (`0x80000003`) before its smoke renderer starts. The preload bundle itself is produced and covered by tests, but runtime bridge checks were not observed in Electron during this checkpoint. An earlier current-tree `npm run dev` attempt exited with the same code before Pixel startup logging or a visible window.
- Consequently the monochrome screenshots, Windows cursor motion/click-through, DPI and monitor transitions, Dynamic Island focus/flicker behavior, PTT, permissions, DeepSeek UI, and actual Workspace/Settings runtime are **unverified here**. No visual pass is claimed. Exact target-laptop steps are in `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`.
- The latest reviewed main commit is `fce3128f42dd540e15f85c13a300105727784e02`; Windows CI run [#16 passed](https://github.com/cypskip-create/Pixel/actions/runs/44328842235) on that SHA (`windows` job: success). This is the pre-change baseline, not CI evidence for the current uncommitted working tree. No release was published.

See [`docs/architecture/PIXEL_DESIGN_TOKENS.md`](docs/architecture/PIXEL_DESIGN_TOKENS.md) for the old-to-new token map and [`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md) for exact visual, motion and functionality checks. The prior Interaction Engine section is retained as historical baseline.

## Previous checkpoint — Interaction Engine 3.0

Branch: `codex/interaction-engine-3`. Started from `b7ccac1fc17824317a1606f5b89bb61a13bbc52d`. The implementation and this validation entry are committed together locally; nothing was pushed or published.

- Added a testable Dynamic Island state reducer with a 144×52 DIP native idle surface and 138×38 visible pill, 140 ms hover, 950 ms pointer grace and 4.5 s idle collapse. Click-pinned presentation preserves drafts, approvals and ongoing tasks. Geometry changes only for fixed presentation surfaces; response text scrolls internally and preserves manual scroll-up.
- Added configured global push-to-talk with a narrowly scoped native key-release watcher. The helper observes only the configured chord, enforces a 20-second bound, and returns distinct release/cancel/timeout/failure outcomes. Keydown starts capture without a capability-probe delay; only audio is requested, at most 20 seconds is held, and the Island displays a small live waveform without opening or focusing chat.
- PTT release finalizes one session and submits one valid local transcript through the existing chat and permission system. Manual microphone dictation only inserts text into the draft. Cancellation paths include explicit stop, emergency stop, window destruction, screen lock and suspend. Speech uses installed Windows System.Speech or optional CPU/int8 faster-whisper with an already cached model; no model download or cloud audio path is enabled.
- Added PTT shortcut validation/conflict handling, watcher crash/restart and terminal-transition tests, fixed a release-state regression that previously skipped capture finalization, and fixed modifier parsing in the C# helper. Native helper compilation and the configured-chord CLI smoke pass (`released`, exit 0).
- Added the original geometric reactive Workspace character and shared recording/transcription/assistant state. Workspace surfaces use the cooler blue-charcoal palette; the Island remains a compact original dark Pixel surface. No Acrylic, Mica or backdrop blur was added.
- `npm run typecheck`: passed (renderer, main and test projects).
- `npm test -- --reporter=dot`: **781 passed, 0 failed, 2 skipped (783 total; 45 files passed, 1 skipped)** with Playwright Chromium installed and local fixture access enabled. The two skips are the opt-in real-desktop foreground integration tests. The isolated NSIS preflight suite separately passed **9/9**; the browser file passed **22/22**.
- `npm run build`: passed (main/preload build, Vite renderer and icon generation). The unpacked package build passed to `artifacts/interaction-engine-3-rc-20261118/win-unpacked`; `app.asar` contains `dist/main/preload/index.js`, whose only runtime `require` is `electron`, and the package includes `PixelNative.exe`.
- `npm run test:preload-sandbox`: **unverified/blocked**. Electron 45.2.3 exited with `2147483651` (`0x80000003`) before the smoke application started or produced a report. The Electron binary also returns this code for `--version`; no current-branch Pixel window or startup log was created. A visible Pixel process belongs to the separate `C:\dev\Pixel` checkout and was not treated as evidence.
- The default `npm run pack` attempt could not resolve `github.com` in the restricted shell. After network-enabled packaging was allowed, the same source produced the isolated unpacked Windows artifact above; no signing or publishing occurred. `npm run dist`, portable launch, NSIS install/upgrade/uninstall and packaged GUI use remain unverified.
- Local Windows capability probing varied by execution context: the sandboxed probe reported `speechToText=false`, while the full Windows test context reported `speechToText=true` and `textToSpeech=true`. This does not prove microphone capture or accurate transcription. No hardware PTT conversation, CPU/memory/latency benchmark, 100/125/150% DPI review, real display click-through, or GPU comparison was completed.
- Existing `.github/workflows/windows-ci.yml` covers typecheck, sandbox preload smoke, Chromium tests, native helper compilation, packaging and artifact upload. No GitHub run corresponds to this local branch because it was not pushed. The packaged GPU/renderer-child-process issue remains a separate unresolved diagnosis; this preload and interaction work does not claim to fix it.

See [`docs/validation/INTERACTION_ENGINE_3_READINESS.md`](docs/validation/INTERACTION_ENGINE_3_READINESS.md) for status categories and exact evidence, and [`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md) for the laptop procedures. Earlier progress entries below are historical.

## Previous checkpoint — conversation-first Workspace

Current branch: `codex/ui-experience-2`. Starting commit: `1000f622157ebd50aec83cae35a92635c2009dbf` (original dark floating UI restoration). The Workspace redesign is a focused local change; no push or release was made.

- Replaced the always-open activity panel with a closed-by-default task-details panel. Current activity appears as a compact conversation status; approvals remain inline and actionable. Completed tasks do not become the current task when no work is active. Unresolved postconditions say **Awaiting verification**.
- The Workspace now opens to the conversation, with recent chats in a 232px sidebar and secondary pages grouped under Library. The chat header has a compact mode trigger and contextual menu; Search the web no longer uses a blocking prompt. The composer starts at one line and grows to 160px. Emergency stop remains in the title bar, and F11 still toggles fullscreen.
- Conversation scroll sticks only when already near the bottom; sending a new turn and opening another conversation return to the bottom. Recent history can be opened, renamed and deleted with confirmation. Project, task, skills/routines, memory, tools, settings, attachments, voice and screenshot controls remain accessible.
- New components: `WorkspaceSidebar`, `WorkspaceConversationHeader`, `CompactModeSelector`, `WorkspaceComposer`, and `WorkspaceTaskActivity`/`WorkspaceTaskDetails`. Added UI regression tests for the compact mode menu, keyboard/focus dismissal, sidebar navigation/recent chat selection, composer resizing/send/stop, task detail access and verification status. Task presentation tests ensure terminal tasks never fill the active slot.
- `npm run typecheck`: passed (renderer and main projects).
- `npm run verify`: passed. This includes both TypeScript projects, production build, preload bundling, Vite renderer and icon generation. Full Vitest result: **732 passed, 0 failed, 26 skipped (758 total; 40 files: 39 passed, 1 skipped)**. The 26 skips are 17 browser checks without Playwright Chromium, 7 NSIS checks without `makensis`, and 2 opt-in native foreground integration checks. Fixture writes used `%TEMP%` as the temporary `USERPROFILE`; the installed Python runtime was supplied through `PIXEL_PYTHON`.
- Focused Workspace/task/architecture checks: **31 passed**. `git diff --check` passed.
- Native Workspace screenshot acceptance at 1366×768 and 1920×1080 remains **unverified**. `npm run dev` could not produce a targetable window here: the standard Vite port 5199 was occupied, and the Electron child exited with `2147483651` (`0x80000003`). Vite did run on 5299, but the branch-local Electron launch still produced no branch window/startup log. The visible Pixel process belongs to `C:\dev\Pixel`, a different checkout; it was not used as evidence. No before/after screenshots were captured.
- The existing GPU/renderer child-process issue remains separate. This UI change does not claim to resolve it. The regular development `--disable-gpu` diagnostic remains unchanged.

Follow the new **Conversation-first Workspace acceptance** section in `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md` for exact laptop screenshot and interaction steps. Earlier test counts and visual results below are historical.

## Previous checkpoint — original dark floating UI restoration

Current branch: `codex/ui-experience-2`. Restoration is based on `0da5b8b53c0bd8fe0ba38106c794456e0a9d50d1`; this change is the focused restoration commit.

- Restored the original dark navy surface colors from `bd4401661a5003d09f609957591096e38734cf17` (`0.88` primary, `0.95` raised) while preserving the transparent native window needed for its shape. Windows explicitly uses `backgroundMaterial: 'none'` in the floating and Workspace windows; no Acrylic, Mica, CSS backdrop filter, Acrylic variables or renderer query override remain.
- Removed backdrop blur from the floating companion, its redesign-only gradient highlight and extra toolbar capsule. Restored the reference commit's dark shadow stack and borders; the lower toolbar is back to its original unboxed row. The supplied geometric P mark, buttons and current layout remain.
- The Workspace layout, controls and dark surface colors, cursor character, task verification display, chat/history, search, settings, DeepSeek bridge, permissions and emergency stop are retained. Its prior Mica and CSS blur materials are removed.
- A completed task record with unresolved `pendingVerifications` now displays **Needs verification** and excludes that step from its verified count. Persisted status and task actions are unchanged. The existing executor already fails closed when it cannot verify a requested postcondition.
- Added `npm run dev:gpu` / `dev:electron:gpu` for GPU-enabled development comparison. Existing `npm run dev` still uses `--disable-gpu`; production does not disable GPU.
- `npm run typecheck`: passed.
- `npm test -- --reporter=default`: **721 passed, 0 failed, 26 skipped (747 total; 39 files: 38 passed, 1 skipped)**. Skips: 17 browser checks because Playwright Chromium is absent, 7 NSIS checks because `makensis` is absent, and 2 opt-in native foreground integration checks.
- `npm run build`: passed (main TypeScript, bundled sandbox preload, Vite renderer and app icon).
- `git diff --check`: passed. The focused appearance regression test checks the restored navy fills/borders/shadows, absence of CSS/system backdrop material and transparent companion window.
- `npm run test:preload-sandbox`: could not run to completion in this environment. Electron 45.2.3 exited with `2147483651` (`0x80000003`) before creating a report; its log contains launcher metadata but no Electron stderr or smoke JSON.
- GitHub Actions run `44159366265` (Windows CI run 7, PR #9 merge SHA `9ee0298fe4dcc738cf264f9b60b9673fd47e65d7`, containing the prior `c090ec0` head) failed in the test step: 10 document tests used a hard-coded developer Python path absent on the runner, and one worker cancellation test depended on a fixed 50 ms startup delay. Native compilation and packaging were skipped after the test failure. Existing changes on this branch configure Python 3.12, use a discovered/explicit interpreter path, and wait with a bounded deadline for worker startup. The workflow has not been rerun because this branch is local and the user will push.
- Before restoration, Windows DWM readback reported Acrylic (`DWMSBT_TRANSIENTWINDOW`, value 3) for Pixel. The restored build has not yet been read back or captured, so visual acceptance remains unverified.
- GPU diagnosis remains separate: existing environment evidence includes Chromium Crashpad “not connected” and a sandboxed Electron GUI-start failure. This points to child-process coordination in that environment, but does not identify the root cause of the packaged failure on the user's laptop. No GPU/driver report or post-change packaged GPU run is available.
- Interactive visual acceptance over white/dark webpages and the desktop remains **unverified**. The existing targetable Pixel process is from a separate, inaccessible `C:\dev\Pixel` checkout. Its Vite server occupies port 5199; Vite started on 5299, but this sandbox's Electron child process exited before app startup. No screenshots were captured and no current-branch GUI behavior is claimed. Normal-GPU startup, packaged app, portable executable and installer flows also remain **unverified**. No user data, credentials, history or app identity were changed.

See `docs/validation/PIXEL_RELEASE_READINESS.md` for evidence and `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md` for the exact laptop acceptance procedure. Earlier checkpoint counts below are historical.

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
- Routine tool steps are deterministic and ordered, with supported result predicates. Active tool-only skills also have a one-time declared-input form whose values are redacted from task/audit text. Daily schedules still exclude inputs; non-tool replay and broader predicate semantics remain incomplete. Specialist coordination runs through the live bounded model-tool loop.

### Unverified

- Actual Notepad → Pixel, VS Code → Pixel and browser → Pixel context sequences; multiple Pixel-window exclusion; permission denial/cancellation; close/stale detection; and live approved UIA action/verification. The opt-in integration run could not read a trustworthy foreground HWND from this runner.
- Runtime launch of the unpacked and portable packages; clean install, upgrade, uninstall and user-data preservation. This packaging attempt stopped on a blocked electron-builder download before an unpacked app was produced.
- The user's reported `window.cyps`/`window.cypsShell` sandbox smoke was not repeated here; Settings key persistence and DeepSeek conversation are outside this checkpoint. The user reports Pixel starts on the target laptop.
- Floating orb, task/approval UI, cursor-follow and the live Pixel UIA workflow remain unverified in this run because this desktop launch did not produce a targetable Pixel window.
- The GitHub Actions workflow itself; it becomes runnable after the user pushes this branch.

### Missing

- General credential broker, broader predicate language, VirtualBox/SSH and Pixel Code.
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

## Core Tools continuation (2026-11-21, uncommitted)

- Browser tab management is registered and routed through the existing session:
  create, list, switch and close with scoped IDs and URL/title read-back. Chromium
  lifecycle tests are present but blocked here because `cdn.playwright.dev`
  returns DNS `ENOTFOUND` during browser installation.
- Migration 8 adds project-scoped notes and personal planning tasks distinct
  from agent execution history. The agent can create/read/search/update/delete
  notes and create/list/update/complete tasks through strict main-process tools.
  Mutations read back saved state; active-project scope is taken from main, not
  model arguments. Note deletion remains high-risk and requires fresh approval.
- `tests/productivity.test.ts` covers tool schemas, registry visibility,
  project isolation, CRUD, postcondition read-back and shared executor routing.
  Six service/tool tests and one renderer create/edit test pass. `npm run typecheck`
  passed after this addition.
- Final full Vitest run: **889 passed, 28 skipped, 0 failed (917 total; 64
  files passed, 1 opt-in file skipped)**. Skips: 18 Chromium-dependent tests
  (browser binary unavailable), 7 local NSIS integration tests (`makensis` is
  absent), and 3 opt-in native foreground tests. `npm run build`,
  `npm run build:native`, and `npm run test:voice-worker` passed; Python worker
  tests were **12/12**.
- The actual `npm run dev` attempt failed because port 5199 is occupied, then
  Electron exited `2147483651 (0x80000003)`. The sandboxed preload smoke also
  exited with `2147483651` before its app entry point. CUA found only the
  already-running Pixel process under `C:\dev\Pixel`, a different checkout;
  it was not interacted with. No GUI result is claimed for this worktree.
- Still outstanding: checklist grouping,
  Markdown import/export, semantic workflow recorder/replay, live specialist
  delegation, document authoring, interactive desktop annotation, offline
  model inference, and actual Windows GUI/install acceptance. No claims of
  Windows acceptance are made for this worktree.

## 2026-11-21 follow-on: Workspace design system and reference research

- Continued from committed `8288850ac825d5b5c1b79656f1432622a8129bf7` on
  `main`; the working tree was clean at start. Baseline Windows workflow
  [44882229282](https://github.com/cypskip-create/Pixel/actions/runs/44882229282)
  passed. It is committed-source CI evidence, not installed-app GUI acceptance.
  This follow-on is local and uncommitted.
- Inspected the supplied 1170×789 Ostrand screenshot and public Inspora Folders
  and ASCII Sharks references. `docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md`
  records observations, adaptations, unknowns and source links. ASCII Sharks
  is MIT. Its fixed-step simulation, capped frame accumulator, resize/visibility
  observers, reduced-motion handling and cleanup informed Pixel's lightweight
  adaptation; no upstream code/assets were copied.
- Added warm semantic matte tokens, compact grouped navigation plus existing
  conversation history, searchable project grid/list over real local records,
  and a subtle `·+·` Pix-side animation paused while hidden or reduced motion
  is requested. See `docs/architecture/PIXEL_DESIGN_TOKENS.md`.
- `npm run typecheck` and final `npm run build` passed. Full Vitest with
  `PIXEL_TEST_HOME=%TEMP%`: **934 passed, 28 skipped, 0 failed** (962 total; 72
  files passed, 1 skipped). Final focused renderer/theme rerun: **22/22**.
  `npm run build:native` passed and `npm run test:voice-worker` passed **12/12**.
  Chromium, local NSIS and opt-in native foreground cases remain skipped.
- Local unpacked Windows packaging was attempted with `npx electron-builder
  --win --dir --publish never`; it stopped while fetching a packaging helper
  because `github.com` DNS failed. Existing `release` installer, portable and
  unpacked artifacts predate this attempt and were preserved; no new package or
  successful local packaging result is claimed.
- REA current-session verification is recorded in
  `docs/debug/REA_INTEGRATION.md`: the fixture analysis and three public browser
  captures succeeded. Analysis of packaged Pixel remains timed out; no source
  artifacts or screenshots were added to the repository.
- An earlier CUA capture showed Pixel from a separate `C:\dev\Pixel` checkout;
  it showed older Chats/Library navigation and was left untouched. In the
  latest inventory, after the user accepted the Electron access prompt, no
  Pixel app window was available. Launching this checkout's diagnostic
  Electron window exited without a visible target; no root cause is
  established. This tree still has no real before/after screenshot or UI
  acceptance.
- Note-to-document links now have project-scoped storage, supported-file
  validation, metadata-only renderer payloads, and open/unlink controls. Store
  and React bridge interactions are tested; native dialog/open remains unverified.
- The UTF-8 `file_write` safeguard refuses known binary document/media/archive
  extensions; Markdown, CSV and JSON round trips plus PDF-byte preservation on
  refusal pass in the new full suite.
- Latest Windows checks: `npm run dev` now selects an available loopback port;
  its renderer started, but Electron exited `2147483651` (`0x80000003`) without
  a targetable window, even with isolated temporary APPDATA. No other Pixel
  process was stopped.
  `npm run diagnose` reported 19 pass, one network failure (`api.deepseek.com`
  fetch failed), and one warning (no installed speech recognizer). Explicitly
  selecting the installed `.pw-browsers` Chromium allowed it to launch, but the
  host denied loopback fixture traffic (`ERR_NETWORK_ACCESS_DENIED`): the opt-in
  browser file had 13 pass, 2 fail and 10 skipped. These remain environment
  blockers, not application acceptance evidence.
- Default `npm run dev` now uses Vite's actual loopback port, falls forward when
  5199 is occupied, and passes the bound URL to Electron. Port-fallback tests
  pass; Electron's host exit remains unresolved.
- Remaining: capture/compare at standard, minimum and narrow dimensions; finish
  document authoring and safe workflow replay; verify plugin
  UI and live public GitHub read; complete actual Windows/voice/browser
  acceptance when the required runtime/access is available. Do not mark 6.2 or
  6.3 complete and do not start Pixel Code.
- Latest follow-on validation (2026-11-21): TypeScript check passed, production
  build passed, `git diff --check` passed, and the complete Vitest suite reports
  **934 passed, 28 skipped, 0 failed** (962 total; 72 files passed, 1 skipped).
- The bounded coordinator is now connected to live agent tool selection through
  `delegate_to_specialist` for research, browser, systems, and knowledge.
  Child tools use allowlists and central validation/approval, with bounded
  steps/time/tokens, no recursive delegation, task-history capture and
  emergency-stop checks. Focused executor/coordinator integration tests pass.
  Windows execution and durable recovery remain unverified.
- Tasks & Activity now converts completed verified task tool steps into a
  project-scoped skill draft for review. String arguments become required named
  inputs instead of being copied from task history; incomplete, secret-marked,
  unsupported and overlong tasks are refused. Typecheck and production build
  pass; full Vitest is **934 passed, 28 skipped, 0 failed**. Routines now execute
  ordered tool plans; active tool-only skills also support one-time declared
  inputs with task/audit redaction. Daily scheduling with inputs, non-tool
  steps, broader predicates, and Windows acceptance remain open.

## Browser forms and transfers follow-on (local, uncommitted)

- Browser snapshots now expose accessible names from field labels, ARIA labels,
  `aria-labelledby`, names and placeholders. Actions support exact role, label,
  placeholder or text targets and reject ambiguous, hidden or disabled targets.
  CSS selectors remain available for pages with poor accessibility metadata.
- Field fills read back the value without returning it and refuse password
  fields pending a dedicated credential broker. Submission requires explicit
  `submit: true`, a fresh critical approval for that exact action, and an
  `expectedText` confirmation check after Enter. A click target check is not
  treated as proof of the resulting state; callers must run `browser_verify`.
- Browser uploads require a critical exact-action agent approval, then a
  main-process file picker and separate confirmation naming the selected file
  and site. Credential-like filenames, symlinks, non-regular files and files
  above 25 MB are refused. The exact enabled file input is set and its filename
  and size read back; this does not claim the site accepted the upload.
- Browser downloads require fresh approval and a native Save dialog, cap at
  25 MB, refuse overwrite with exclusive file creation, fsync and verify the
  saved bytes by size and SHA-256. Pixel never opens or executes the result.
- Browser tests use disposable local HTML/file fixtures with local-file access
  enabled only on the isolated test session, because host loopback networking
  is denied. Cached real Chromium passes **30/30** browser tests and tool policy
  passes **29/29**, including actual upload selection and download read-back.
  Native Electron dialog, remote site acceptance, and real app-window/network
  acceptance remain unverified.
