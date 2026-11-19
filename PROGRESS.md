# Pixel progress

Updated: 2026-11-19. Version: 0.2.1.

## Current checkpoint — Tools 4.2 memory, persistent permissions and UI Automation

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
