# Pixel implementation handoff

## Core Completion 6.2 continuation — current local changes

Reviewed source at `64e0383484cfcbc35370c9f8aa2498f9428dd15d`; it matches the
latest GitHub `main` as of 2026-11-21. The latest hosted Windows CI run
[44869374637](https://github.com/cypskip-create/Pixel/actions/runs/44869374637)
passed on that exact commit, including NSIS setup, type checking, local worker
tests, sandboxed preload smoke, full tests, native helper compilation,
unpacked/portable/NSIS packaging and artifacts. It predates the local edits
below.

- `file_search` now accepts validated size and modified-time bounds.
- Added `file_open` through main-process `shell.openPath`, limited to
  home-scoped folders and supported documents/images. It rejects symlinks,
  executable/script types, and credential-like paths. It reports that Windows
  accepted the request and the path still exists; visible app activation is not
  claimed.
- Added approval-gated `file_trash` through `shell.trashItem` for one
  home-scoped regular file, with credential-like name refusal and original-path
  absence verification. Its test adapter is deterministic; the real Windows
  Recycle Bin path remains unverified.
- Current local validation after the productivity UI: TypeScript check passed;
  Vitest **893 passed, 28 skipped, 0 failed (921 total; 64 passed files, 1
  opt-in file skipped)**; production build and native-helper build passed;
  Python worker tests were **12/12**. Chromium, local NSIS and foreground
  integration requirements account for the 28 skips.
- These file-tool and documentation changes remain uncommitted and are not
  covered by the hosted CI run. Actual application opening, model execution,
  installed-app behavior and Windows GUI acceptance remain unverified.

- Browser tab create/list/switch/close tools use the existing `BrowserSession`,
  registry and executor. Always-on dispatch/schema tests pass; live Chromium
  tests remain skipped because downloading from `cdn.playwright.dev` fails with
  DNS `ENOTFOUND`.
- Added migration 8 with project-scoped notes/tasks, model-visible tools, typed
  preload/main IPC and a `Notes & Planning` Workspace page. Project isolation,
  CRUD, postcondition read-back and renderer note create/edit/import tests pass.
  Markdown export is verified by read-back in the main process. Checklist
  grouping is implemented in migration 9; descriptions and due dates remain editable in Workspace.
- A fresh `npm run dev` attempt failed because port 5199 is occupied; Electron
  exited `2147483651`. The Electron sandbox smoke also exited `2147483651` before
  its app entry point. CUA found the only existing Pixel windows under
  `C:\dev\Pixel`, a different checkout; they were not changed.
- `git diff --check` passed. Local changes remain uncommitted, and no hosted CI
  run covers them. The latest green run is still
  [44869374637](https://github.com/cypskip-create/Pixel/actions/runs/44869374637)
  on base `64e0383`.

## Core Completion 6.2 clipboard and batch-file work (committed in 64e0383)

## Core continuation after browser and productivity work (local, 2026-11-21)

Changes remain uncommitted on top of `64e0383484cfcbc35370c9f8aa2498f9428dd15d`.

- Browser tab tools now create/list/switch/close pages through the existing
  `BrowserSession`, central registry and executor. Exact IDs are session-local;
  URL checks remain behind `NetworkGuard`. Always-on tests cover dispatch and
  result verification; actual Chromium tab tests cannot run because the browser
  archive download failed with DNS `ENOTFOUND`.
- Added migration 8 and project-bound `notes_*` and `tasks_*` tools. The main
  process selects the active project; create/update/completion reads the saved
  row back for verification. Note deletion is high-risk and approval-gated.
- Productivity store/tool tests cover CRUD, grouping, project isolation and
  renderer editing; descriptions and due dates are editable in the task UI.
  Markdown import/export uses native dialogs and main-process file access.
  Migration 9 adds distinct project-scoped checklists and task assignment.
- Superseding final local run (2026-11-21): TypeScript passed; Vitest **893
  passed, 28 skipped, 0 failed (921 total; 64 files passed, 1 skipped)**; the
  final production build passed; native helper build passed; voice worker tests
  passed **12/12**. The skipped tests require Chromium, local NSIS, or an
  opt-in Windows foreground fixture. `git diff --check` passed.
- A final local `npm run pack` rebuilt the app and native helper, then failed
  in `build-voice-worker.ps1` because the Windows Python launcher found no
  suitable runtime (the required Python 3.12 x64 is absent). No packaged app or
  installer was produced from this tree.
- Last green GitHub run remains [44869374637](https://github.com/cypskip-create/Pixel/actions/runs/44869374637) on `64e0383`; no hosted run covers this local work.

Base source reviewed: `e57f11ef4ec2e4b03c436ca68e6488459a2b6eee`.
This section records the predecessor changes; no release was published.

- Latest cited Windows Actions run
  [44786311339](https://github.com/cypskip-create/Pixel/actions/runs/44786311339)
  passed on the base SHA, including typecheck, tests, preload sandbox smoke,
  helper compilation, unpacked/portable/NSIS builds and artifact upload. Artifact:
  [pixel-windows-ci-36.zip](https://github.com/cypskip-create/Pixel/actions/runs/44786311339/artifacts/14653789646).
  It is not acceptance evidence for the local edits or an interactive install.
- Added registered `clipboard_read`, `clipboard_copy`, `clipboard_restore`, and
  `clipboard_paste` operations. The main process owns access. Reads/writes are
  approval-gated; common credential-like values are blocked; copies are
  read-back verified; a prior non-secret text value up to 20,000 characters
  can be conditionally restored from an in-memory five-minute snapshot with
  timed expiry. Clipboard-reading turns are
  session-only in chat history, and durable task results are replaced with a
  content-free privacy note. The “paste” tool sets a selected UIA ValuePattern
  field (replacement semantics) and verifies read-back; it is not raw Ctrl+V.
- Focused clipboard/file/agent tests passed **58/58**. After adding a
  test-only `PIXEL_TEST_HOME` fixture root, the full local suite passed **877**,
  skipped **27**, failed **0** (904 total; 62 files passed, 1 skipped).
  Typecheck, production build, native helper compilation and Python worker tests
  (**12/12**) passed.
- The local GUI could not be launched in this checkout. CUA found a separate
  Pixel session at `C:\dev\Pixel`; no interaction was performed with it.
  Thus actual Settings Back navigation, clipboard operation, model tool calls,
  local speech inference/playback, installer install/upgrade/uninstall, and
  laptop acceptance remain unverified.
- The local preload smoke rebuilt the current bundle but Electron exited
  `2147483651` (`0x80000003`) before writing its smoke report. The local
  `setup:voice-dev` probe found only Python 3.15 x64 and refused because the
  pinned speech runtime requires Python 3.12 x64; neither a venv nor model
  assets were changed.
- A tracked wave-by-wave status matrix is in
  [`PIXEL_CORE_TOOLS_6_2_CHECKLIST.md`](docs/validation/PIXEL_CORE_TOOLS_6_2_CHECKLIST.md).
  Most 6.1 deliverables remain incomplete; this follow-up does not mark the
  overall Core Tools checkpoint complete, and external account integrations
  remain deferred.

## Core Tools 6.1 local reliability checkpoint

Latest GitHub `main`/local base reviewed: `69106e8d9a40cacd49d2f2b2d228b06ca80585d3`.
The worktree was clean before edits. No commit, push, or release was created.
Latest Actions evidence is failing run
[`44765517201`](https://github.com/cypskip-create/Pixel/actions/runs/44765517201).

Follow-up after the initial handoff review:

- Selected-window screen observation can now be explicitly saved as a durable
  grant bounded by the exact verified process name and exact window title. It
  can be reused across HWND/PID changes and app restarts; it excludes click,
  invoke, typing, and all state-changing actions. Missing process/title identity
  cannot be made persistent. Exact-window session grants remain available.
- Follow-up targeted authorization, permission-store, tool, and hardening tests:
  **68/68 passed**. Latest full suite after this policy change: **868 passed,
  0 failed, 27 skipped (895 total)**; the 27 skipped tests need Chromium, NSIS,
  or an interactive Windows foreground fixture. `npm run build` passed.
- No new Windows GUI or hosted Actions evidence is available. The CI fix and
  all other changes remain uncommitted for the user to push and verify.

- Workspace Settings now has a visible Back to Workspace button and remembers
  the preceding page. Chat draft/history remain owned by Workspace, chat scroll
  is restored, and Settings voice resources are released on unmount.
- CI NSIS setup now rechecks the standard install directories after Chocolatey
  success before attempting the pinned-hash fallback. The failed run installed
  NSIS 3.13 at `C:\Program Files (x86)\NSIS` but then used an invalid/mismatched
  3.11 fallback hash because it skipped that recheck.
- Voice setup now identifies that this machine has Python 3.15 x64 and lacks
  the pinned Python 3.12 x64 worker environment. No user model files were
  removed. There is no live transcription/TTS evidence for this machine.
- Added upstream revision/license comparison in
  [`PIXEL_CORE_TOOLS_6_1_RESEARCH.md`](docs/research/PIXEL_CORE_TOOLS_6_1_RESEARCH.md).
  Outbound DNS blocked cloning packages; none was copied into production.
- TypeScript, production build, Vitest (**866 passed, 27 skipped, 0 failed**),
  Python worker tests (**12/12**) and native helper build/smoke passed. Skips:
  17 Chromium-dependent browser tests, 7 NSIS tests, 3 foreground integration
  tests. Chromium install failed with DNS `ENOTFOUND`; NSIS is not installed.
  The sandboxed preload smoke exits `0x80000003` before its report.
- Real Windows GUI was attempted with isolated app-data. Vite’s default 5199
  port reports occupied with no listener visible; alternate Vite 5299 starts,
  but Electron exits 1 without creating a visible window. No GUI or installer
  acceptance is claimed. The current CI fix still needs the user’s next push to
  produce a hosted Windows Actions result.
- Still missing/partial per the 6.0 capability audit: editable desktop overlay,
  clipboard tools, complete document authoring, semantic workflow recording,
  live specialist execution, broad diagnostics and generalized critical-risk
  policy. Plugin account integrations remain deferred.

## Current Core Tools 6.0 audit and repairs

Reviewed local `main` base: `d538c1044c9f6c4a0e7edc8073877436cae8dc4f`.
Changes are uncommitted; no push or workflow run was made.

- Pix now appears in Workspace only beside the composer; Dynamic Island Pix is
  retained. Added a cancellable, reduced-motion/hidden-aware idle activity
  scheduler and corrected live expression priority. Focused Pix/state tests
  cover interruption, sleep, wake, and state conflicts.
- Tools now have distinct Files/Documents categories. The Tools page groups
  registered functions and shows relevant dependency checks, approval behavior,
  and an explicit partial/unavailable list. See
  [`docs/validation/PIXEL_CORE_TOOLS_6_AUDIT.md`](docs/validation/PIXEL_CORE_TOOLS_6_AUDIT.md)
  for the complete capability matrix and gaps.
- Windows CI has bounded Chocolatey retries and a pinned-hash official NSIS
  fallback for the observed HTTP 503 failure. YAML/PowerShell parsing passed;
  hosted CI has not rerun, so recovery is not verified.
- Validation: typecheck and production build passed; Vitest **862 passed, 27
  skipped, 0 failed**; Python worker **12/12**; native helper compiled and its
  protocol smoke passed. Browser/NSIS tests skipped because Chromium/`makensis`
  are absent. Sandboxed Electron smoke still exits `0x80000003` before its
  report; development launch still cannot bind port 5199. No real Windows UI,
  installer, screenshot, or live agent acceptance is claimed.
- Remaining scope is substantial: no clipboard agent tools, freehand desktop
  annotation/editor, screen-to-Board asset flow, full document authoring,
  semantic workflow recorder, connected specialist delegation, broad system
  diagnostics, or generalized critical-risk policy. Existing Board, file,
  screen, browser, voice, memory, permission, and task code is documented by
  verified and unverified status in the capability matrix.

---

## Current follow-up — voice development runtime, composer Pix and navigation

Reviewed base: `8ed850fbb3b2f1d550e7f246d916a99491da3fc9` on `main`.
Current small follow-up changes are local and uncommitted. The latest Windows
workflow run `44593414322` passed on the preceding commit `3897a2a`, not these
changes.

- Development voice now uses a dedicated `.venv-voice-dev` and
  `npm run setup:voice-dev`, separate from PyInstaller's build environment.
  The explicit setup installs pinned runtime packages, verifies CTranslate2
  CPU support, ONNX Runtime CPU, and the worker JSONL protocol. Optional
  `-ModelPath` checks the selected model files; adding `-AudioPath` performs
  local inference and prints the transcript. Runtime setup/inference has not
  been executed on this laptop, so neither model readiness nor recognition is
  claimed. The user-reported absent `.venv-voice-build` and frozen worker were
  not rechecked here.
- A missing development faster-whisper dependency now produces a setup
  instruction rather than a packaged-reinstall message. Packaged worker
  failures still direct users to repair/reinstall.
- The setup interpreter override now uses `PIXEL_VOICE_DEV_PYTHON`; the prior
  error text incorrectly referred to the packaging-only override. The duplicate
  app-section rail was removed; navigation remains in the expandable sidebar,
  with emergency stop in the Workspace header.
- Workspace places a 44 px Pix beside the composer. During idle it schedules
  an occasional bounded short exploration/ball interaction. Task/listening/
  response states, reduced motion, component cleanup and hidden-document
  visibility stop idle play. Windows visual timing and Island containment are
  not verified by this change.
- Board, desktop drawing, permission, Cursor Buddy, packaged worker and native
  Windows acceptance remain subject to the existing checkpoint limitations.
  No commit, push or CI run was created.
- Regression audit: the full Vitest suite includes Board service/tool
  registration, session-scope checks, Pix expressions/play cleanup, Workspace
  navigation and Cursor Buddy geometry/trust coverage. The separate Python
  worker suite passed 12/12, the native helper rebuilt, and the latest known
  Windows workflow passed all steps on parent `3897a2a`. These are automated
  regressions; they do not prove model inference, live DeepSeek Board execution,
  screen overlay placement, or desktop companion visibility.
- Validation after this follow-up: TypeScript and production build passed;
  Vitest **858 passed, 0 failed, 27 skipped (885 total; 61 files passed, 1
  skipped)**; Workspace controls **8/8**. Browser and NSIS tests skipped for
  unavailable Chromium/`makensis`. An invalid Python override check confirms
  the setup error names `PIXEL_VOICE_DEV_PYTHON`. Existing Python worker tests
  (12/12) and native helper build/protocol smoke passed on the earlier CI
  checkpoint. Dependency installation, real model inference and the Windows
  GUI remain unverified. No local changes have CI validation.

## Current local checkpoint — Experience 5.2

Latest GitHub `main` reviewed: `d98fbe896c4893fadc506b7fd0783e570dfbd3f8`.
The supplied successful Windows CI run
[`44567448710`](https://github.com/cypskip-create/Pixel/actions/runs/44567448710)
ran on `0a8f39f68bf54bc10ac3274521ef348b8289080a`, its parent. Current work is
local and uncommitted; no commit, push or CI run was created.

- **Board ownership:** `src/main/board/service.ts` owns the active validated
  Board, document revision, undo/redo, profile draft and file import/export.
  Renderer manual edits and agent tool calls share this service via typed IPC.
  Legacy localStorage drafts are copied once and left in place.
- **Agent tools:** 15 Board tools are in the model schema and actual dispatcher,
  with strict contracts and mode policy. `board_create_diagram` adds a title,
  nodes and optional edges as one verified, undoable service change. The
  AgentExecutor integration test inspects the model-facing schema and confirms
  the dispatcher changes the persisted Board and requests Workspace focus.
- **Desktop guidance:** `screen_draw_arrow` uses exact accessible-control
  bounds from one identified window and draws only a temporary passive arrow.
  It does not perform input. Existing UIA-bound rectangle/circle/arrow guidance
  remains. Freehand/editable desktop drawing and desktop save/export remain
  incomplete.
- **Permissions:** low-risk window metadata is automatic. A user may grant a
  volatile session scope for screen observation/passive guidance on a selected
  window; the main process matches opaque window reference, PID, process and
  title on each call. This does not authorize state-changing computer input.
  Agent/Hybrid Board editing is medium-risk and automatic; Guide blocks these
  mutations. Critical-action generalization is not complete.
- **Workspace:** separate 48-DIP app rail, 276-DIP chat sidebar and dark
  conversation canvas; Settings uses its own category sidebar. User bubbles
  are blue and right-aligned; Pixel replies stay unboxed. The current Settings
  and Workspace layout changes require the final build and laptop comparison.
- **Cursor Buddy:** distinct rounded rectangular grayscale cursor character;
  Pix stays the silver/mint app mascot. Shape and hotspot logic have tests but
  no post-change Windows screenshot.
- **Evidence:** final local `npm run typecheck`, `npm run build:native` and
  `npm run build` passed.
  Final full Vitest: **856 passed, 0 failed, 27 skipped (883 total; 60 files
  passed, 1 skipped)**, run with an isolated `USERPROFILE` under
  `.pixel-test-profile`. Playwright Chromium and `makensis` are unavailable, so
  the browser and NSIS-dependent tests skipped. The supplied Windows Actions
  run is green on the parent commit, not this worktree. Windows UI launch was
  attempted with isolated user data, but development launch stopped when Vite
  reported fixed port 5199 occupied and direct built Electron launch exited
  code 1 without a window/log. Actual UI, screenshot comparison, cursor
  visibility, external-window annotation and native file dialogs still need
  laptop acceptance.

See [`docs/architecture/PIXEL_BOARD_AGENT.md`](docs/architecture/PIXEL_BOARD_AGENT.md)
for the Board tool contract and remaining limits.

## Current local fix — Cursor Companion IPC trust

Latest GitHub `main` reviewed: `0a8f39f68bf54bc10ac3274521ef348b8289080a`.
The focused fix is local and uncommitted; no commit, push or workflow run was
created.

- The laptop log showed the cursor renderer's `settings:get` and
  `window:cursorRendererReady` calls rejected by the generic application IPC
  guard. That guard intentionally trusted only Island, Settings and Workspace,
  so the ready acknowledgement never reached `WindowManager` and the 8-second
  timeout kept Cursor Buddy hidden.
- Cursor IPC now allows only a trusted main-frame readiness acknowledgement
  and a reduced-motion-only preference read. The window identity and trusted
  renderer URL are checked; other application capabilities remain unavailable
  to Cursor Buddy. The cursor renderer also denies popup and external
  navigation.
- Validation: focused policy tests **6/6**, typecheck, full Vitest **842
  passed, 27 skipped, 0 failed (869 total)** and production build passed. The
  sandbox preload smoke rebuilt the bridge but Electron exited `0x80000003`
  before renderer startup. The cursor still needs a post-fix visible test on
  the laptop. GitHub reports no checks for latest main; this local fix has no
  Actions run.

## Latest merged checkpoint — Experience 5.1 & Tools 5.2

Reviewed base: `47d1db1284c7860ec52ddf1f6dd50bf532a2f8b4` (`main`). The user
checkpoint is now merged on `main` at `0a8f39f68bf54bc10ac3274521ef348b8289080a`.
The Cursor Buddy follow-up above remains uncommitted.

- Windows Actions run `44542308139` (run 29 on this base SHA) passed through
  typecheck, worker safety, sandbox preload, full suite and native-helper
  compilation. Packaging failed at the frozen runtime smoke with
  `RUNTIME_SMOKE_FAILED` / `RuntimeError`; artifact upload then succeeded. The
  log does not identify the failing native call. Source inspection found no
  explicit eSpeak path setup, a plausible cause. The worker now configures
  bundled paths, retains the Windows DLL-directory handle and reports a
  redacted stage. Python unit coverage passes; the frozen Windows binary and a
  new Actions run still need verification.
- Workspace Settings now has supported, persisted category navigation. Charcoal
  values align with the supplied Codex screenshot; blue is used for controls
  and a small selected-nav indicator, while Pix's mint art remains unchanged.
  Screenshots and scaling comparison are still outstanding.
- The compact Island uses animated Pix in the assistant identity slot, while
  the Pixel P stays in the brand lockup. Task terminal states now briefly feed
  Pix success/error expression and active signals keep higher priority.
- Actual TTS playback start/stop now originates in the main-process voice
  service and is broadcast through typed preload methods to Island, Workspace
  and Settings windows. A focused test verifies late initial-state responses
  cannot overwrite live playback changes; real Windows audio/UI timing remains
  unverified.
- Pixel Board is an in-Workspace editable vector board with local draft
  recovery, object creation/move/remove, undo/redo, `.pixelboard` save/open,
  and SVG/PNG export. It does not annotate the Windows desktop. The
  click-through guidance overlay remains separate and passive.
- The four-tier critical-action policy, per-task Agent observation toggle,
  interactive desktop drawing, screenshot insertion, PDF export and
  coordinate-based input are not implemented. Existing security controls have
  not been weakened.
- Final changed-code checks: typecheck and production build passed; Vitest
  **839 passed, 27 skipped, 0 failed (866 total; 57 files passed, 1 skipped)**;
  Python worker tests **12/12**; native helper compiled and its protocol smoke
  completed. The sandbox preload smoke failed with `0x80000003`, and the
  Python 3.12 frozen build, NSIS, Actions rerun, packaged GPU behavior and real
  Windows screenshots remain unverified.

See [`docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md`](docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md) for the previous 5.0 record and updated 5.1 follow-up.

Updated: 2026-11-19

## Historical handoff — Experience Polish 5.0 and official Pix

Base SHA reviewed: `6ac637e2149872e112b78177b3dcda41c2c8c764`.
Branch: `codex/interaction-engine-3`. All work below remains uncommitted for
the user to inspect and commit. No release was published.

- **CI repair:** the latest reviewed Windows Actions run
  [44522917967](https://github.com/cypskip-create/Pixel/actions/runs/44522917967)
  stopped at packaging: the frozen voice worker answered `BAD_JSON` before a
  valid JSON request was available. The packaging smoke now uses
  `scripts/smoke-frozen-voice-worker.mjs`, sends an explicitly encoded UTF-8
  JSONL frame from Node, validates the response and bounds process lifetime.
  Since the frozen Python 3.12 executable cannot be built in this environment
  and the changes are unpushed, the repair has **no successful CI run yet**.
- **Official mascot:** `src/renderer/components/PixMascot.tsx` contains the
  single SVG geometry and expression mapping for the approved Pix: light-silver
  rounded shell, dark face, folded mint top-right corner, expressive mint eyes,
  small arms and feet. Workspace header, new-chat welcome, current assistant
  messages and the expanded Island use appropriately sized variants; historic
  message avatars are static. Settings has an optional expression preview.
  Pix is not the cursor follower.
- **Character activity:** `src/renderer/hooks/useCompanionAnimation.ts` uses
  bounded idle blink timers, pauses when the document is hidden, cleans timers
  up and respects the app setting plus Windows reduced-motion preference.
  Existing assistant states drive expression. The behavior is covered by
  component/state tests, but visual timing and performance have not been
  measured on the laptop.
- **Cursor Buddy:** retained as its own pointer-shaped component and native
  window. Settings can show a clearly labeled artwork preview; the real native
  follower stays hidden while Settings is open. Cursor visibility is no longer
  coupled to Workspace focus or Island idle state. A typed ready message and
  timeout/error diagnostics now describe native lifecycle. Actual Windows
  visibility, click-through, focus and multi-monitor behavior remain
  unverified.
- **Theme and controls:** the existing black/charcoal design now has a
  distinguishable sage enabled switch with keyboard/ARIA semantics and focus
  ring. Approved Pix artwork uses reference mint. Screenshot comparison and
  display-scaling review remain outstanding.
- **Daily file operations:** added bounded home-only search and metadata, safe
  one-level folder creation, exclusive copy and verify-before-source-removal
  rename to the existing scoped filesystem tool system. Clipboard and new
  broad app/browser workflows were not implemented; existing tool systems are
  retained.
- **Validation:** `npm run typecheck` passed; `npm run build` passed; Vitest
  **834 passed, 27 skipped, 0 failed (861 total; 54 passed files, 1 skipped)**;
  Python worker tests **11/11**; native-helper build/protocol ping passed; the
  harmless WinForms UIA fixture passed with 3 verification records and 61
  durable events. Full output/report details are in
  `docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md`.
- **Still unverified/blocked:** sandbox preload smoke exits `2147483651`
  before output; Electron GUI could not launch a changed-code instance because
  port 5199 belonged to another checkout; Chromium download fails DNS; no
  Python 3.12 x64 or `makensis`; therefore frozen worker, package artifacts,
  screenshots, visual matrix, GPU behavior and end-to-end real Pixel task UI
  are not claimed as passed. No new GitHub Actions run exists.

The exact Windows commands and acceptance sequence are in
[`docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md`](docs/validation/PIXEL_EXPERIENCE_POLISH_5_READINESS.md)
and [`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md).

## Previous checkpoint — Tools 4.2

Branch: `codex/interaction-engine-3`. Local HEAD before these uncommitted
changes: `cbac143ec28b0b19669aa58a911b5f53af0f5b5e`. No commit, push or release
was made; the user will commit and push.

- Automatic memory uses deterministic, bounded main-process extraction for
  direct user preferences, selected Pixel project assertions, explicit memory
  requests/corrections and completed tasks with verified steps. Secrets,
  prompt-injection phrasing and copied external instructions are filtered.
  Records are isolated to the active project, semantically deduplicated by
  preference slot, revisioned on correction, searchable, editable, exportable,
  and deletable. Automatic Memory defaults on and remains user-disableable.
- Always Allow / Allow Once / Deny is wired through the main-process broker.
  SQLite stores revocable Always grants with exact application/origin scope and
  policy version. Persistent approval is restricted to Notepad/Calculator/Paint
  launches and HTTPS origins. High-risk or unsupported operations cannot get a
  standing grant. Emergency Stop revokes active grants, cancels operations and
  pending approvals.
- UIA uses ValuePattern for exact selected controls, verifies value read-back
  without returning/logging the value, and supports semantic select/toggle/
  scroll/expand/collapse operations with post-action read-back. The latest real
  fixture report passed ValuePattern entry, InvokePattern, separate
  postcondition verification, TogglePattern state and durable task reload
  (3 verification records, 61 events). Earlier attempts failed at provider
  operations. Direct and documented `npm run test:native-uia-fixture` runs
  exited zero after a test-only cleanup fix confirmed helper and fixture
  terminal status. Pixel's visible approval UI remains open. See the tracked result at
  `docs/validation/PIXEL_TOOLS_4_2_UIA_FIXTURE_RESULT.md` and the raw report in
  the local `artifacts/windows-acceptance/` folder.
  Automatic task-outcome capture now refuses any completed task record
  containing a failed step, pending verification, or no verified step. The
  actual Pixel approval UI, emergency-stop workflow and laptop multi-step
  acceptance are still pending.
- Focused tests: **172/172 passed**. Final full Vitest: **815 passed, 27
  skipped, 0 failed (842 total; 52 passed files, 1 skipped)**. The 27 skips are
  missing Playwright Chromium (17), missing NSIS `makensis` (7), and opt-in
  native desktop integration (3). Typecheck, production build, native helper
  compilation and protocol ping passed. Python worker tests: **11/11**.
- Current local HEAD is `cbac143ec28b0b19669aa58a911b5f53af0f5b5e`; the brief's
  latest reviewed main SHA is `f607621bdc2fe9503df722f410423f630c700db2`.
  GitHub Actions run `44498305105` failed only at the packaged Voice 4.1 worker
  protocol smoke after earlier CI steps passed. The worker returned `BAD_JSON`
  because it received no JSON request. This checkpoint updates its PowerShell
  stdin encoding but does not yet verify a rebuilt packaged Python 3.12 worker;
  there is no CI run for current unpushed changes.

See [`docs/architecture/PIXEL_MEMORY.md`](docs/architecture/PIXEL_MEMORY.md)
for memory policy and
[`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md)
for exact rebuild and Windows acceptance instructions.

## Current handoff — Voice Engine 4.1

Branch: `codex/interaction-engine-3`. Base commit before these uncommitted
edits: `d6031d9c0909413622b082fe9b8035a2acac01ba`. No commit, push or release
was made.

- Voice 4.1 repairs the Python build version probe; captures direct PCM through
  AudioWorklet; supports bounded 120-second manual dictation while keeping PTT
  at 20 seconds; adds an explicit Settings voice test, opt-in diagnostics and
  short user-selected recording export; reports actual recognition backend and
  inference timing; chunks long Kokoro text and reports voice-test timing; and
  adds a private-corpus benchmark harness. Existing Pixel features and
  permission/security boundaries are retained.
- Validation: typecheck and production build passed; full Vitest **801 passed,
  27 skipped, 0 failed (828 total)**; Python worker/benchmark tests **11/11**;
  compileall passed. Chromium install was blocked by DNS. Electron 45.2.3
  exited `2147483651` before smoke output. Python 3.15 was correctly rejected
  by voice build preflight without creating a venv.
- Python 3.12 voice-worker packaging, an unpacked/portable/installer build,
  microphone/speaker inference and CI remain unverified. No real corpus or
  hardware results were available; no accuracy or naturalness improvement is
  claimed. The previous GitHub run `44485597153` is still the failed baseline;
  the fix has no new CI run until pushed.
- Use [`docs/validation/PIXEL_VOICE_READINESS.md`](docs/validation/PIXEL_VOICE_READINESS.md)
  for exact evidence and limits, and
  [`docs/validation/PIXEL_VOICE_ACCEPTANCE.md`](docs/validation/PIXEL_VOICE_ACCEPTANCE.md)
  for build, benchmark and Windows acceptance instructions. Complete those
  checks before another voice or tools milestone.

Sections below record earlier checkpoints and their historical test totals.

## Previous checkpoint — Tools 4.1 screen intelligence and visual guidance

- Branch: `codex/interaction-engine-3`; local HEAD
  `ea110700e37173b2a88708bf617b2b17dbeed9bf`. The working tree is
  uncommitted for the user to commit and push. Nothing was published.
- Screen capture now selects exact native window identity instead of relying
  on Electron capture-source ordering. Window captures use the native helper;
  display/region capture matches display IDs, records actual dimensions and
  scale, and refuses ambiguous cross-display regions or changes during
  capture. Region coordinates are global virtual-desktop Electron DIP.
- Vision results are identified as model interpretation; UI Automation control
  details remain separately attributed. Empty vision output, stale targets,
  ambiguous controls and failed captures do not produce a success claim.
- The separate guidance window is sandboxed, transparent, click-through,
  focusless and short-lived. It draws only around a revalidated, unique UIA
  control. It expires and clears on stale identity, session lock and emergency
  stop. There is no click/type action in the new guidance workflow.
- Validation: typecheck passed; focused screen/agent/guidance tests **31/31**;
  full suite **782 passed, 0 failed, 27 skipped (809 total; 48 files passed,
  1 skipped)**; production build and native helper build passed. Skips:
  17 browser cases (Chromium absent), 7 NSIS cases (`makensis` absent), 3
  opt-in native integration cases.
- The opt-in native integration was attempted with a harmless blank Notepad
  fixture and failed **3/3** with `The observed window or process is no longer
  available.` No real native capture or overlay behavior is verified in this
  environment. Chromium and NSIS checks are skipped, not passed. The prior
  development launch is blocked by occupied Vite port 5199 and Electron's
  pre-app exit `0x80000003`; packaged GPU/renderer failures are separate and
  unresolved.
- Follow `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md` on the target laptop.
  Do not begin another feature wave until the foreground-helper failure is
  diagnosed and the capture-to-highlight flow is observed end to end.

## Current handoff — Monochrome design and cursor companion

- Branch: `codex/interaction-engine-3`; current local HEAD `7f10c058c70545f760923eb5b01b5da7764ca773`. Its tree matches latest reviewed `main` commit `fce3128f42dd540e15f85c13a300105727784e02` before these local edits. The repair is local and uncommitted; the user will commit and push; nothing was published.
- The floating Island, Workspace, Settings, menus, task states, status indicators, and characters now use the black/charcoal semantic theme. Navy, cyan and colored renderer accents were replaced by neutral grayscale tokens. The Pixel P master geometry remains intact; in-app artwork uses semantic gray foreground values. Visible panels are opaque, with no Acrylic, Mica, blur or decorative gradients.
- The cursor character is now 28×28 DIP in a 36×36 DIP native window (previously a 54×54 SVG in a 64×64 DIP window). Its pointer hotspot, small cursor-relative offset and work-area placement are calculated together. The critically damped follower is bounded to 12 DIP, snaps after large jumps/resume/display changes, skips unchanged native position writes, and hides/stops while Pixel is expanded, hidden, locked or disabled. The window remains focusless and click-through.
- `npm run typecheck`: passed. Full suite: **789 passed, 0 failed, 2 skipped (791 total; 46 files passed, 1 skipped)** with local Playwright fixture access. The skipped checks are the opt-in real desktop foreground integration tests. Separate NSIS preflight: **9/9 passed**.
- `npm run build`: passed (main, bundled secure preload, renderer and app icon). `npm run build:native`: passed (helper compiled and protocol smoke returned successfully).
- `npm run test:preload-sandbox` remains **unverified**: Electron 45.2.3 exited `0x80000003` before its smoke window or renderer started. A development launch in this host exited before Pixel startup logs/window as well. This does not show whether the local UI looks or behaves correctly on the user's laptop.
- Windows visual/motion acceptance remains outstanding: monochrome appearance, DPI and multiple displays, cursor tracking/click-through, Island focus/flicker, PTT, Settings, DeepSeek, history, permissions and emergency stop. No screenshots or cursor-motion recording were available. See the current Windows acceptance section in `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`.
- The latest reviewed `main` commit is `fce3128f42dd540e15f85c13a300105727784e02`; Windows CI run [#16 passed](https://github.com/cypskip-create/Pixel/actions/runs/44328842235) with its `windows` job successful. That run predates these local edits; no CI run is associated with the current uncommitted working tree.
- The separate packaged GPU/renderer-child-process report remains unresolved and is not attributed to this visual/cursor work. The standard development command keeps `--disable-gpu`; the GPU-enabled comparison command remains available. No security flags were weakened.

See [`docs/architecture/PIXEL_DESIGN_TOKENS.md`](docs/architecture/PIXEL_DESIGN_TOKENS.md) for the palette migration and [`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md) for the exact laptop procedure.

## Previous handoff — Interaction Engine 3.0 baseline

- Branch: `codex/interaction-engine-3`, based on `b7ccac1fc17824317a1606f5b89bb61a13bbc52d`. The complete interaction checkpoint is committed locally only; nothing was pushed or released.
- Dynamic Island uses fixed 144×52 idle bounds with a 138×38 visible pill. Hover/click/leave/idle transitions are reducer-driven; token streaming never controls native window geometry. Response scrolling preserves the user's position.
- Global PTT uses the configured accelerator plus a short-lived native release watcher that samples only that chord, cancels on helper failure and times out at 20 seconds. Microphone capture is explicit and audio-only. Release submits one valid local transcript; manual dictation stays in the draft. Shared state drives the Island and Workspace character.
- The Workspace keeps its existing conversation-first structure and original geometric reactive character. This earlier checkpoint used cool blue-charcoal surfaces; the current monochrome checkpoint above replaces them.
- TypeScript passed. Full suite: **781 passed, 0 failed, 2 skipped (783 total; 45 files passed, 1 skipped)** with Chromium/local fixture access. NSIS preflight: **9/9**. Native helper compiled and its configured PTT chord smoke returned `released` with exit 0. Production build passed.
- An isolated unpacked artifact is at `artifacts/interaction-engine-3-rc-20261118/win-unpacked`. The archived preload was inspected: it contains no local CommonJS imports and keeps Electron as its only runtime require. The helper is packaged beside it.
- Real app/sandbox smoke remains blocked: Electron 45.2.3 exits `0x80000003` before app code, including for `--version`; the current branch did not create a targetable window. Microphone, dictation accuracy, PTT focus, GPU behavior, visual/DPI, portable and installer flows remain unverified. No CPU/memory benchmark or GitHub run was produced. CI remains configured in `.github/workflows/windows-ci.yml`; this branch is local and was not pushed.
- The only skipped automated tests are two opt-in native foreground desktop integration cases. See [`docs/validation/INTERACTION_ENGINE_3_READINESS.md`](docs/validation/INTERACTION_ENGINE_3_READINESS.md) and the Interaction Engine section of [`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md).

## Previous handoff — conversation-first Workspace

- Branch: `codex/ui-experience-2`; base commit `1000f622157ebd50aec83cae35a92635c2009dbf`. The focused Workspace changes are local and have not been pushed.
- The app opens to a compact conversation view. Recent chats and New Chat remain in the sidebar; secondary destinations are grouped under Library. Mode selection and web search are in the compact conversation header. The composer auto-expands. Emergency stop remains accessible in the title bar.
- Activity is closed by default. Active work is summarized inline with an on-demand details panel. Permission cards are visible in the conversation. Terminal tasks no longer occupy the active-task panel; unresolved UI postconditions are labeled Awaiting verification.
- Conversation history, rename/delete confirmation, project selection, tasks, skills/routines, memory, tools, Settings, voice, screenshot capture, attachments, Island synchronization, and existing IPC/security contracts are preserved.
- `npm run verify`: passed (both TypeScript projects, all tests, preload/renderer production build and icon generation). Full tests: **732 passed, 0 failed, 26 skipped (758 total; 40 files)**. Skips: 17 Chromium-dependent browser checks (Chromium absent), 7 NSIS checks (`makensis` absent), 2 opt-in native foreground integration checks. Focused Workspace/task/architecture checks: **31 passed**.
- Native screenshots at 1366×768 and 1920×1080 were not captured. The standard dev server port 5199 was occupied; `npm run dev`'s Electron child exited with `2147483651` (`0x80000003`). Vite started on 5299, but the current branch still did not produce a targetable Electron window. The visible Pixel window belongs to the separate `C:\dev\Pixel` checkout and was not treated as evidence.
- GPU/renderer child-process reliability remains a separate issue and is not claimed fixed. See the new **Conversation-first Workspace acceptance** steps in `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`.

## Previous handoff — original dark floating UI restoration

- Branch: `codex/ui-experience-2`; restoration is based on `0da5b8b53c0bd8fe0ba38106c794456e0a9d50d1`. This is the focused restoration commit.
- The companion is back on its original navy colors (`0.88`/`0.95` fills), border and shadow stack, with no native system backdrop, no CSS backdrop blur, no redesign gradient highlight and an unboxed lower toolbar. Its transparent native shape, P logo and controls remain.
- Workspace layout, controls and dark surfaces remain; native Mica and CSS blur are removed. Cursor character, task verification status, history, search, DeepSeek and security behavior remain. The GPU-enabled dev script and CI fixes are also retained.
- Typecheck and production build passed. Full Vitest suite: **721 passed, 0 failed, 26 skipped (747 total; 39 files)**. The 26 skips are 17 missing Chromium, 7 missing NSIS and 2 opt-in native integration tests. The preload sandbox smoke exits before reporting (`2147483651` / `0x80000003`).
- Visual acceptance on white and dark web content and the desktop is unverified: this environment's Electron child process exits before app startup, while the already-open Pixel window belongs to a separate `C:\dev\Pixel` checkout. No screenshots were captured.
- The earlier Windows CI run 7 (`44159366265`, PR #9 merge SHA `9ee0298fe4dcc738cf264f9b60b9673fd47e65d7`) failed on a developer-only Python path and a fixed-sleep worker race. Those CI fixes are present in the branch but need a push to rerun.
- The prior DWM readback reported Acrylic for Pixel before this rollback. The current build has not been read back or captured. The separate packaged GPU issue remains unresolved; existing Crashpad child-process evidence does not establish a laptop GPU root cause.
- Read `docs/validation/PIXEL_RELEASE_READINESS.md` for exact evidence and `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md` for the next laptop steps. Earlier counts below are historical.

## Previous UI Experience 2.0 wave notes (historical)

- The current branch and HEAD are listed in the handoff section above. The
  remaining notes in this section describe earlier checkpoints and their
  test counts are superseded by the current 747-test result above.
- Checkpoint 1 implements the single measured companion panel stack and one
  accessible mode selector. It has not yet been visually accepted on the
  target laptop.
- Checkpoint 2 implementation is complete: the primary bar uses a persisted
  display anchor, the cursor follower has a separate passive window, and
  Settings selects the display and configures the independent follower.
  Typecheck, build, full automated suite and diff check pass; 26 tests remain
  skipped for unavailable browser/NSIS/native-integration prerequisites. Native
  visual acceptance remains unverified. Those counts are historical; use the
  current validation section below for the full UI/history/search tree.
- Checkpoint 1 local validation: typecheck/build/diff-check passed; full tests
  **669 passed, 0 failed, 26 skipped (695 total; 30 files)**. Browser tests
  need Playwright Chromium, NSIS tests need `makensis`, and the target-window
  integration suite is opt-in. The test run redirected `USERPROFILE` into the
  workspace for fixture writes. No target-branch native screenshot was taken.
- The running Pixel UI observed during this work is from `C:\dev\Pixel`, a
  different checkout; it was not modified or counted as acceptance evidence.
- A separate Vite server on port 5200 and a branch-local Electron launch with
  `--disable-gpu` did not produce a targetable branch window (Electron exited
  0 before startup logging). This is an unverified GUI attempt, not a pass.
- Do not begin unrelated computer-control, drawing, cloud-computer or Pixel
  Code work during this UI/history/search wave.

### Previous integration checkpoint result (historical)

- Completed the panel/layout, display-anchored bar, independent cursor companion, persistent conversations/Recent Chats, configured default-browser search, and compact response/settings/task polish.
- `npm run typecheck`: passed. `npm run build`: passed.
- Focused suite: **69 passed across 8 files**. Full suite: **712 passed, 0 failed, 26 skipped across 36 files (738 total)**. Browser and NSIS prerequisites were unavailable; the native foreground integration is opt-in.
- A final repeat was stopped before Vitest returned a result; the counts above are from the latest completed full-suite run.
- The isolated electron-builder packaging attempt failed before output with `getaddrinfo ENOTFOUND github.com`; existing `release` artifacts were preserved.
- `npm run test:preload-sandbox` also stops before the smoke application starts: Electron 45.2.3 exits with `2147483651` (`0x80000003`), without the main-entry marker or report JSON. The harness now clears stale reports and saves launcher diagnostics. This is a pre-app Electron runner failure here, not a failure reported by a bridge assertion.
- Windows GUI acceptance remains unverified; the Computer Use attempt was stopped before selecting an app. The Windows procedure is in `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`.
- GitHub Actions investigation found no status checks on remote `main` HEAD `0be3ba45b5b94a2018969670490a8c9b6ad8e80b` and no workflow run for the current unpushed branch. The job log for the reported preload-smoke failure was unavailable, so its remote root cause is not established. The workflow and local smoke script were inspected without weakening the sandbox; rerun `npm run test:preload-sandbox` on Windows or the next CI run to capture the actual failure.
- Local `HEAD` remains `f10084e6f11129e4c453ba546ed09e50e6b9d8de`; the worktree is intentionally uncommitted for the user to commit.

## Delivered in this tree

- Durable SQLite task snapshots/events, Zod contracts, conservative restart recovery, pause/resume/cancel, task budgets, verification evidence and a compact execution timeline.
- Cancellation propagation through browser, Python/voice workers, child process trees and the native UIA helper; emergency stop also stops queued routine work.
- Scoped, one-shot high-risk approvals; prompt-injection data framing; exact-window title checks before Windows text input and native UIA invocation.
- Human takeover state with explicit acknowledgement and a required fresh observation before any later mutation.
- Compiled and connected C# UI Automation helper for foreground-window information, bounded semantic element search, exact unique enabled `InvokePattern` invocation, and exact present/absent postcondition checks. Timed-out/cancelled helpers are boundedly terminated; unconfirmed exit quarantines future calls and retains the desktop-input lease.
- Optional cursor-follow presentation now uses a separate transparent, non-focusable, click-through BrowserWindow. The main bar stays anchored and cannot be dragged; the follower pauses while active panels are open.
- Main-owned conversation lifecycle now persists sanitized user-facing turns through `HistoryStore`, restores bounded model context, respects `privacy.persistHistory`, and supports the Recent Chats search/create/restore/rename/delete flow. Writes are session-only when persistence is disabled or unavailable.
- Explicit browser-search commands open a fixed, validated Google/Bing/DuckDuckGo results URL through the operating system's default browser. Model-proposed search uses the existing permission gateway, and Pixel reports the launch without claiming result access.
- Response reasoning stays collapsed and separate; speech and task completion feedback now match the observed backend outcome. Settings sizing and screenshot/image-attachment labels were corrected.
- Project memory inspection, correction, deletion and JSON export; versioned skill drafts/review/activation/run history; durable daily routines with missed-run skip, serialization, cancellation, failure pause and one-time manual retry.
- Windows CI for type checks, Chromium/NSIS tests, sandboxed preload IPC smoke, native-helper compilation and non-publishing distributions. Build logs, smoke/JUnit results and package artifacts are uploaded by the workflow.
- The Electron preload is bundled with esbuild. Its complete local runtime graph includes the shared IPC registry, with only `electron` external. Dev, build, pack and dist all pass through `build:main`; the existing `window.cyps`/`window.cypsShell` contracts and sandbox settings remain unchanged.
- Bundle tests cover external imports, shared-channel inclusion, both bridge names and security flags. A separate real-Electron sandbox IPC smoke command is available as `npm run test:preload-sandbox`.
- A harmless Windows Forms UIA fixture and deterministic AgentExecutor/PermissionBroker/SQLite harness are available for a real Windows desktop.
- Refreshed current-state report, Grok Bot mapping, Clicky mapping, runtime/security/skills documentation, Windows acceptance procedure, README and PROGRESS.

## Important files

- Agent/task/policy: `src/main/agent/`, `src/main/tasks/`, `src/main/agents/coordinator.ts`, `src/main/agent/inputLease.ts`.
- Native Windows helper and build: `native/PixelNative/PixelNative.cs`, `src/main/services/nativeHelper.ts`, `scripts/build-native.ps1`.
- Skills/routines/memory: `src/main/skills/`, `src/main/routines/`, `src/main/memory/`.
- UI/settings/history: `src/renderer/components/RecentChatsPanel.tsx`, `ConversationTranscript.tsx`, `SettingsPanel.tsx`, `TaskStrip.tsx`, `src/renderer/App.tsx`, `src/renderer/hooks/useChat.ts`, `src/main/history/`.
- Search: `src/shared/browserSearch.ts`, `src/main/agent/tools.ts`, `src/main/agent/executors.ts`, and the narrow browser IPC methods in `src/main/ipc.ts` and `src/preload/index.ts`.
- Packaging: `electron-builder.yml` copies `native/bin/PixelNative.exe` to `resources/native/PixelNative.exe`; `pack` and `dist` build the helper first.
- Tests: `tests/tasks.test.ts`, `agent-executor.test.ts`, `native-agent-tools.test.ts`, `skills-routines.test.ts`, `memory.test.ts`, `safety.test.ts` and the existing browser, file, document and provider suites.

## Validation performed for the preceding checkpoint on 2026-11-17

- `npm run typecheck`, `npm run build`, `npm run build:native` and `npm run pack` passed.
- Full suite: **655 passed, 0 failed, 0 skipped across 26 files**. All 22 Chromium browser tests and all 9 NSIS tests ran.
- The unpacked `app.asar` contains the current `dist/main/preload/index.js` byte-for-byte; it has no local CommonJS import and keeps only Electron external.
- The hidden Electron sandbox smoke process exited with `2147483651` before app or preload logging. A desktop launch attempt exposed no Pixel window in this Codex session. The user reports their laptop's main process, window and React renderer now start, but final bridge injection/IPC acceptance has not yet been confirmed there.
- The previous GPU/renderer child-process issue remains separate. Existing environment diagnostics identify Chromium startup/Crashpad failures before a window, but do not prove a root cause. The preload bundle change does not claim to fix GPU behavior.
- The native helper and timeout/lease unit tests passed. The real fixture was not foregrounded in this desktop session, so `test-native-uia-e2e` did not invoke a control. Pixel approval-card/UIA action acceptance remains unverified.
- Voice test capability output differed by execution context. No fixed local STT/TTS availability is claimed.
- Windows CI was not run from this local tree. It runs after CI is triggered; it uploads artifacts and never publishes a release.

## Remaining work and limits

- Run the ordered UI and distribution checklist on an interactive Windows laptop: development startup/logs, renderer/preload, orb, conversation, task strip, approval cards, cursor following, fixture UIA task, unpacked/portable launch, clean install, upgrade, uninstall and user-data preservation.
- Run `npm run test:native-uia-e2e` with `Pixel UIA Harmless Fixture` in the foreground; then complete the actual Pixel approval-card task separately. The deterministic harness grants one-use approvals through the backend broker but does not display the UI.
- Native UIA reads accessible names/AutomationIds, checks exact present/absent states and invokes one exact unique enabled `InvokePattern`; it does not type, set form values or operate inaccessible/custom controls. It verifies only within the same exact titled foreground window and can report an empty process name for some desktop providers.
- Skills are user-reviewed and model-mediated. There is no interaction recorder, automatic save-from-task prompt or deterministic live semantic replay runner.
- Specialist roles/coordinator are foundations, not independent model-backed delegations in the live task flow. VirtualBox/SSH and Pixel Code are unavailable.
- There is no general credential broker. Passwords, MFA, passkeys, CAPTCHA and payment confirmation remain human tasks.
- Restart recovery asks the user to review and start a new task; it does not continue the old model call stack. A task acknowledgement does not prove the handoff action succeeded.
- Browser private-network checks detect some unsafe connections after the connection begins; preventing the network request itself requires a controlled egress proxy.
- The current release readiness decision and exact artifact sizes are in [docs/validation/PIXEL_RELEASE_READINESS.md](docs/validation/PIXEL_RELEASE_READINESS.md).

## Historical branch status — conversation-first Workspace

Branch: `codex/ui-experience-2`. This describes the earlier Workspace checkpoint, not the current `codex/interaction-engine-3` working tree above.
