# Pixel project handoff

Updated: 2026-11-22. This file is the short recovery point for future Codex sessions.

## Repository state

- Existing checkout: `C:\Users\cypri\OneDrive\Desktop\cyps`, branch `main`.
- Current committed HEAD and `origin/main`: `74f3973293992e3c44c5194f3f84b90f758d15f5`, branch `main`. This continuation started from `8288850ac825d5b5c1b79656f1432622a8129bf7` and preserved later committed test additions.
- The last confirmed Windows CI run [44916016724](https://github.com/cypskip-create/Pixel/actions/runs/44916016724) passed on `0780c18d22ce1c07ba195527f952ac9cb9f7d37d`, including typecheck, automated tests, native helper compile, package build and artifact upload. GitHub's status endpoint returned no records for `74f3973`; CI for current HEAD is unverified. Earlier run [44882229282](https://github.com/cypskip-create/Pixel/actions/runs/44882229282) passed on `8288850`. CI/package builds do not prove interactive installed-app acceptance. Current local edits are uncommitted and not covered by those runs.
- A fresh `npm run dev` retry built main/preload and the native helper, preserved the occupied 5199 listener, started Vite on 5200, then Electron exited `2147483651` (`0x80000003`) without a targetable window. Follow-up isolation: direct `electron.exe --version` exited with the same code before printing a version, both from this checkout and from the read-only `C:\dev\Pixel` binary; their executable SHA-256 hashes match. A Computer Use launch timed out, and a fresh desktop inventory still showed no Pixel window. No `%TEMP%\Pixel` startup log was created, confirming the process did not reach Pixel's boot logger. Existing `%APPDATA%\Pixel` data was read-only and left untouched. This does not establish a source defect; GUI acceptance remains blocked by the current host runtime.
- Do not commit or push for the user.

## Current checkpoint

Core Tools 6.2 remains open. The 6.3 bundled plugin foundation and read-only
public GitHub metadata plugin predate this continuation. This checkpoint
implements the first warm matte Workspace pass: semantic warm tokens, grouped
navigation plus existing conversation history, project search/grid/list over
local records, and reduced-motion/visibility-aware decorative Pix glyphs. New
source and tests are currently uncommitted. See
`docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md` and
`docs/architecture/PIXEL_DESIGN_TOKENS.md`.

This continuation's latest `npm run verify` passes typecheck, the production
build and the suite: **994 passed, 11 skipped, 0 failed** (1,005 total; 74 files
passed, 1 skipped). `scripts/test.mjs` selects the matching Chromium revision
from `.pw-browsers` when present and preserves an explicit
`PLAYWRIGHT_BROWSERS_PATH`; the full run passed all 30 live Chromium tests.
Remaining skips are seven NSIS tests (`makensis` unavailable), three native
foreground acceptance scenarios and the symlink fixture denied by the sandbox.
The renderer entry is 458.39 kB, below Vite's 500 kB advisory threshold. The
project-indexed Library now groups
actual indexed files into matte folder cards and provides bounded previews over
typed, path-redacted IPC. The Library also has a direct user flow: a native
folder picker, confirmation showing the exact selected path, active-project
indexing and renderer-safe counts. The absolute path stays in main-process
code. Focused tests cover the index result and UI action; native dialog
interaction remains unverified. Latest additions include project-scoped plugin
availability with a global enable ceiling and revocation of persisted, volatile
and pending tool permissions on scope changes, disable, update and uninstall.
The Library preview now also exposes “Open original” for supported indexed
document/text formats. Main-process code rechecks active-project membership and
source freshness before and after `shell.openPath`, refuses stale/missing files,
excludes source-code and macro-enabled spreadsheet formats, and returns no
absolute path to the renderer. A keyboard-accessible folder menu also opens the
actual indexed directory by project-scoped folder ID after symlink/existence
checks. The Library type filter applies to both folder cards and file rows.
Post-change verification passed focused document/Library tests (**45 passed,
1 skipped**), TypeScript checks and production build (458.31 kB renderer entry).
Native Shell behavior remains unverified.
A separate `PLAYWRIGHT_BROWSERS_PATH=.pw-browsers` run previously passed all
**30** browser tests and 29 policy tests against real Chromium and disposable
local-file fixtures. NSIS and live GUI acceptance remain unverified locally.
Document discovery now rejects symlinked roots/entries and credential-like
filenames; the Windows sandbox denied the symlink fixture (`EPERM`), so that
specific regression test skipped locally. The agent can now read bounded,
source-located passages from project-indexed documents and refuses cached text
when its file size/mtime signature has changed. The signature retains
millisecond timestamp precision, with a regression test for same-size edits in
one second; a rewrite that restores both size and mtime remains outside this
metadata-only freshness check. `documents_search` applies this same freshness
gate to FTS hits and withholds stale cached excerpts. The GitHub plugin now
offers a manifest-declared description-detail setting (hidden/compact/full),
persisted and validated in main-process SQLite; it bounds untrusted provider
text and never accepts credentials or arbitrary JSON. Its manifest is 1.1.0.
The plugin subsystem and 6.2 checklist remain open: provider DNS, installed UI,
Electron launch/dialog and Windows interaction have not been accepted.

The native desktop-control path was rechecked in source: opaque window IDs are
resolved against the live HWND, PID, process start identity, process name and
title before selected-target operations. Semantic UIA actions re-query the
control and validate a postcondition. This is implementation evidence, not live
Windows acceptance; richer hierarchy and actual Notepad/app interaction remain
open.
Native helper compilation passes and voice-worker boundary tests pass 12/12.
`VoiceService.capability()` reports `stt=false`, `tts=true`; the host has no
Windows recognizer installed. A short real playback through Pixel's Windows
System.Speech backend passed (5,542 ms). User data holds the `small.en` model
whose main-weight SHA-256 matches the pinned catalog digest, but the host has
Python 3.15.2 only; faster-whisper, Kokoro ONNX and ONNX Runtime are not
importable there, and the inspected unpacked build has no packaged voice
worker. Offline inference and Kokoro playback remain unverified.
Automated plugin tests use a fixture adapter; they do not establish live GitHub
success. A direct public request remains blocked by DNS `ENOTFOUND
api.github.com`. Note-to-document links now store project-scoped references to
supported regular files, expose only display metadata to the renderer and
revalidate before opening. Store and React bridge interactions pass; native
dialog/open behavior remains unverified on Windows. The Plugin Manager is also
extracted as a Workspace component with permission disclosures, connection
state, update metadata, serialized lifecycle actions and failure reporting;
five UI tests cover these interactions. An installed manifest-version mismatch
now displays both versions and offers a reviewed bundled-catalog update; the
update disables the plugin until the user explicitly enables it again. Install
now refuses to upgrade mismatched versions, keeping update audit and lifecycle
semantics distinct.
The supplied Ostrand screenshot was sampled at the outer background, a raised
surface, and the orange chart bar. Rounded warm tokens are recorded in
`docs/architecture/PIXEL_DESIGN_TOKENS.md`; companion and theme tests now
assert the revised values and WCAG AA text contrast. The current renderer build
emits a 457.87 kB entry chunk with route chunks for Library, Plugins, Projects,
Tasks, Notes and Board.
The direct `replaySkill` path was also hardened: it enforces the live runner's
input count/length and credential checks, redacts input echoes from replay
results and callbacks, and sanitizes thrown error text. Focused skill/routine
tests pass 17/17.
The approved text-file path also rejects known binary PDF/Office/media/archive
formats; Markdown, CSV and JSON round-trip tests verify read-back. Rich PDF and
Office authoring remain unsupported; see
`docs/architecture/PIXEL_DOCUMENT_ASSISTANCE.md`.
The bounded coordinator is now connected to the live model-tool loop for
research, browser, systems and knowledge subtasks. Child tools stay behind the
central permission gateway; integration fixtures cover normal calls,
capability denial and approval. Real Windows acceptance and durable recovery
remain open.
Tasks & Activity now offers a user-initiated “Save steps as a skill draft” for
completed verified tasks. Main-process recording is project-scoped, bounded,
rejects unsupported/withheld arguments, and replaces string values with
required inputs. Draft review is editable and saves a new version before
activation. Scheduled routine runs execute the reviewed tool plan in order
through the normal executor; the model cannot select or reorder those calls.
An active tool-only skill can also run once through the declared-input form;
input values are validated and redacted from task/audit text. The runner
enforces current approvals, reviewed per-step approval floors, fresh
observations, supported exact result/URL checks and resolved postconditions.
Parameterized skills remain unavailable to daily schedules, and non-tool
steps and Windows acceptance remain open.
Browser tools now prefer exact accessible role/label/placeholder targets,
require unique visible/enabled click/fill controls, read back filled values
without returning them, and refuse password, secret/token, and one-time-code
fields. Submissions require explicit `submit`, each-call critical approval, an
expected confirmation absent before the action, and matching text read back
afterward. Clicks still require a separate postcondition check. Browser upload
uses a critical per-call agent approval plus a native file picker and second
file/site confirmation, refuses credential-like filenames and unsafe files,
and verifies selected input metadata without claiming remote site acceptance.
Browser download uses a native save picker, a 25 MB limit, no-overwrite
creation and SHA-256 read-back; downloaded data is never opened or executed.
Real Chromium fixture tests exercise both transfers. Electron native dialogs
and external site acceptance remain unverified. The app's default browser
policy still blocks local files and private network addresses; test fixtures
enable local files only in their isolated test session. See the 6.2 checklist
for evidence and limits.

The agent's `get_system_info` now reuses the main-process diagnostics snapshot
for uptime, load average, system-volume capacity (`statfs`), primary display
resolution/scale and Windows battery status. The native helper exposes only
the typed `GetSystemPowerStatus` fields; it omits monitor labels/bounds and
network addresses. `scripts/build-native.ps1 -OutputPath <temp-exe>` compiled
and smoke-tested the updated helper against the actual Windows API without
overwriting the existing ignored helper binary or recording the charge value.
Process and audio-device details remain unfinished.

The Recycle Bin is still a gap. A read-only Windows Shell namespace probe found
zero existing entries. A unique disposable file was then sent with the
Microsoft.VisualBasic `SendToRecycleBin` API; its source disappeared, but the
Shell namespace still exposed zero entries, so the exact-item Restore verb
could not be tested or invoked. No unrelated file was changed.

The GitHub adapter now checks cancellation again after DNS resolution and
validates every returned family/address before opening the pinned TLS socket.
Focused plugin lifecycle/adapter tests pass **9/9**; a live request still
cannot resolve `api.github.com` (`ENOTFOUND`) from this host.

Latest GUI diagnostics: `npm run dev` now starts Vite on an available loopback
port and passes the actual bound URL to Electron. Its renderer started, but
Electron exited with `2147483651` (`0x80000003`) without a targetable window,
even with temporary APPDATA. No other Pixel process was stopped. The installed
Chromium browser was explicitly selected, but its live test fixture was denied
loopback networking by the host (`ERR_NETWORK_ACCESS_DENIED`); see the 6.2
checklist for the exact opt-in test totals. A fresh Windows app inventory after
the user accepted the Electron access prompt returned no Pixel application or
window, so this checkpoint still has no actual Workspace screenshot or UI
acceptance. A post-approval retry on 2026-11-21 rebuilt main/preload/native
components, started Vite on `127.0.0.1:5199`, and again exited at Electron code
`2147483651` (`0x80000003`) without a targetable Pixel window. The native
protocol smoke passed in that run; it does not diagnose the Electron crash.
The project’s `npm run dev:gpu` path was also tried on 2026-11-21 and exited
with the same code after successful builds and Vite startup, so disabling GPU
does not explain the failure. A diagnostic run with
`ELECTRON_ENABLE_LOGGING=1` and `ELECTRON_ENABLE_STACK_DUMPING=1` reported
`EXCEPTION_BREAKPOINT` with an unresolved native backtrace before the Pixel boot
logger. Existing `%APPDATA%\Pixel\pixel-startup.log`
entries identify only prior launches from `C:\dev\Pixel`; no current-checkout
boot marker was written. Querying the Windows Application event log was denied
by the host, leaving the pre-main Electron failure without an OS fault module.
An additional isolated Electron probe using a temporary, data-only app folder
also produced no targetable window; because its process returned exit code 0
without a logged startup result, it does not isolate a cause. A direct Vite
renderer preview on port 5200 started, but the in-app browser timed out and a
local HTTP request was denied by sandbox networking. Playwright Chromium also
returned `ERR_NETWORK_ACCESS_DENIED` for the local Vite URL. Opening the
production bundle as a `file:` URL produced a blank page because its external
module assets could not load under the production CSP; that blank capture was
discarded and is not visual acceptance. The existing listener on port 5199
was left untouched. A fresh Computer Use inventory still lists only two
`C:\dev\Pixel` windows, and the Edge accessibility connection failed, so no
third-party Pixel windows were opened or changed. The preview server and probe
files were cleaned up afterward.
An unpacked packaging attempt stopped before completion because the packaging
helper download could not resolve `github.com`; pre-existing ignored release
artifacts were left intact.

## REA development tool

- `rea-agents@6.10.1` is installed outside the Pixel dependency tree.
- Node `26.13.0`; npm `11.20.0`.
- User approved Codex MCP registration at `C:\Users\cypri\.codex\config.toml`
  and the shared skill at
  `C:\Users\cypri\.agents\skills\reverse-engineer-anything`.
- `codex mcp list` historically reports `rea` enabled / Unsupported; the current
  Codex session now exposes callable REA tools. A disposable JavaScript fixture
  analysis and captures of the Inspora Folders article, ASCII Sharks gallery and
  public GitHub repository succeeded. Evidence IDs, screenshot hashes and
  limits are in `docs/debug/REA_INTEGRATION.md` and
  `docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md`. The Ostrand image was inspected
  as the user attachment. Packaged Pixel analysis timed out, and no live Pixel
  desktop/source analysis or actual reference runtime is claimed. REA screenshots
  remain in the REA service; no third-party artifacts were installed.
- Optional Ghidra/IDA/JADX/Kuna/Hopper engines are absent by design; static JS
  analysis does not require them. Previous DeepSeek REA config was left intact.
- Workflow: `docs/research/REA_REFERENCE_WORKFLOW.md`; installation history:
  `docs/debug/REA_INTEGRATION.md`.

## Product direction

Priority order: complete remaining 6.2, qualify Plugin System 6.3, finish the
Workspace adaptation from the supplied Ostrand screenshot and Folders reference,
then proceed to Pixel Code only in a separately authorized milestone. Preserve
Pixel branding, current Pix behavior, accessibility and working features.

Plugin architecture notes are in `docs/architecture/PIXEL_PLUGINS.md`. Current
catalog is bundled-only and declarative. No arbitrary plugin code executes.
GitHub public metadata requires per-call approval and no account connection.
OAuth, generic credential vault, external MCP lifecycle, remote marketplace,
project-specific installation and third-party executable isolation are not
implemented.

## Windows and 6.2 acceptance limits

Native CUA inspection now works after the user accepted the permission prompt.
The observed Pixel process is from `C:\dev\Pixel`, not this checkout; it was
left untouched. A launch attempt from this checkout exited without creating a
targetable window. Target-tree screenshots/interaction, UIA, clipboard,
installer/portable launches, voice inference/playback, browser flows, Recycle
Bin restore, document authoring/links and Windows dialogs remain unverified.
Never kill another checkout's Pixel process. Do not overwrite user data or
encrypted secrets.

## First commands

```powershell
git status --short --branch
git log -5 --oneline --decorate
npm run typecheck
npm test
npm run build
codex mcp list
```

Read the README, this handoff, PROGRESS, the 6.2 checklist, Windows acceptance
guide, plugin report and relevant subsystem docs before touching an open item.
