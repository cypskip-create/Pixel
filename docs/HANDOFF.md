# Pixel project handoff

Updated: 2026-11-21. This file is the short recovery point for future Codex sessions.

## Repository state

- Existing checkout: `C:\Users\cypri\OneDrive\Desktop\cyps`, branch `main`.
- Committed baseline for this continuation: `8288850ac825d5b5c1b79656f1432622a8129bf7`, branch `main` (initially equal to `origin/main`, clean before this work).
- GitHub Windows CI run [44882229282](https://github.com/cypskip-create/Pixel/actions/runs/44882229282) passed on that exact baseline. It built and tested the source and packages; it did not prove interactive installed-app acceptance. Current local edits are uncommitted and not covered by that run.
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
build and the full default suite: **949 passed, 33 skipped, 0 failed** (982
total; 73 files passed, 1 skipped), using `PIXEL_TEST_HOME=%TEMP%`. The
Chromium-dependent tests are skipped by that default run; a separate
`PLAYWRIGHT_BROWSERS_PATH=.pw-browsers` run passes all **30** browser tests and
29 policy tests against real Chromium and disposable local-file fixtures.
Native helper compilation passes and voice-worker boundary tests pass 12/12.
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
An unpacked packaging attempt stopped before completion because the packaging
helper download could not resolve `github.com`; pre-existing ignored release
artifacts were left intact.

## REA development tool

- `rea-agents@6.10.1` is installed outside the Pixel dependency tree.
- Node `26.13.0`; npm `11.20.0`.
- User approved Codex MCP registration at `C:\Users\cypri\.codex\config.toml`
  and the shared skill at
  `C:\Users\cypri\.agents\skills\reverse-engineer-anything`.
- `codex mcp list` shows `rea` enabled / Unsupported. `rea doctor --client codex
  --skill --json` reports the Codex registration and skill identity healthy;
  optional engines are absent and `live_server` is unknown. A standalone MCP
  stdio fallback negotiated protocol `2024-11-05`, listed 263 tools and called
  `analyze_javascript_application` on a disposable fixture (Evidence
  `ev_8dab99644a9753790a6514321e92cb0d50d076cc4439cc51005c98dbc163759f`). The
  packaged Pixel analysis timed out. REA's public Inspora browser scenario could
  not start Chrome in the host sandbox; crashpad exited and cleanup was reported
  incomplete with no retained resources. The reported PID was absent on a
  follow-up process check; no no-sandbox override was applied. The current Codex
  session still exposes no REA tool namespace. Reference targets remain
  browser/visual-inspected rather than REA-analyzed.
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
