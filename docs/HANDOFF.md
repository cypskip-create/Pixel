# Pixel project handoff

Updated: 2026-11-23. This file is the short recovery point for future sessions.

## Phase B — Git, Files, Rich Documents, GitHub Plugin & Secure Execution (2026-11-23 — Local Uncommitted)

- **B0 CI Regression Root Cause & Cleanup:** Investigated GitHub Actions runs `45168522052` (`0d21e5c`) and `45175291910` (`ec61ca0`, both failed at Step 13 `Run full automated test suite`). Root cause: commit `1178401` switched `tests/files.test.ts` and `tests/tasks.test.ts` from `homedir()` to `tmpdir()`, which on `windows-latest` resolves outside `homedir()` while `FileTools` hardcoded `homedir()`. Fixed by adding injectable `allowedRoot` to `FileTools` and passing `{ allowedRoot: root }` in both suites; also honored `process.env.PIXEL_PYTHON` in `PythonAgentBridge`, removed 4 tracked `__pycache__/*.pyc` files (`git rm --cached`), and added `**/__pycache__/` + `*.pyc` / `*.pyo` to `.gitignore`.
- **B2 Local Git Toolset (`src/main/git/toolset.ts`):** Added `git_remote_list` (with embedded URL credential redaction), `git_repository_info` (branch/detached HEAD, SHA, remotes, staged/unstaged/untracked/conflict counts), `git_stage`, and `git_unstage`; hardened `git_clone` against embedded credentials and unsafe transport helpers (`-c protocol.ext.allow=never -c protocol.file.allow=never`); added structured Git error classification (not installed, lockfile, auth, timeout, cancellation).
- **B3 File Patching, Content Search & Rich Document Reading (`src/main/files/`):**
  - Added `patch.ts` + `file_patch` tool (exact + unambiguous whitespace-trimmed fuzzy matching, multi-hunk, expected SHA-256 verification, CRLF/LF preservation, dry-run preview, atomic sibling temp-file write + read-back SHA-256 check).
  - Added `file_search_content` (bounded UTF-8 text search skipping hidden folders, `node_modules`, symlinks, binaries, and credential-like names) and UNC path rejection.
  - Added zero-dependency `richDocuments.ts` integrated into `file_read` for safe, bounded, macro-free extraction of `.docx`, `.pptx`, `.xlsx`, and text-stream `.pdf` (with ZIP-bomb byte caps, encrypted PDF detection, and untrusted-data framing).
- **B4 & B5 Expanded GitHub Plugin & Secure DPAPI Auth (`src/main/plugins/github.ts`, `manifest.ts`, `settings.ts`, `ipc.ts`, `WorkspacePluginManager.tsx`):**
  - Exposed 13 registered GitHub tools: public/private reads (`github_repo_summary`, `github_repo_branches`, `github_list_dir`, `github_read_file`, `github_list_commits`, `github_compare_commits`, `github_list_issues`, `github_issue_detail`, `github_list_prs`, `github_workflow_runs`) and approval-gated authenticated writes (`github_create_issue`, `github_comment_issue`, `github_create_pr`).
  - Added DPAPI-encrypted `setGitHubToken` / `getGitHubToken` / `clearGitHubToken` in `SettingsStore` (`credentials/github.key`), `verifyGitHubToken` (`GET /user` + `x-oauth-scopes`), IPC channels (`plugins:githubStatus`, `plugins:githubConnect`, `plugins:githubDisconnect`), and a flat optional GitHub account connection control under **Settings → Plugins & Connections** (renderer never receives raw tokens; clearly distinguishes deleting local token vs revoking on `github.com`).
- **B6 & B7 Agent Autonomy & Python `pixel-agent-v2` Parity:** Updated `AGENT_MODE_AUTONOMOUS_TOOLS` (`github_repo_summary`, `github_list_dir`, `github_list_commits`, `github_issue_detail`, `git_remote_list`, `git_repository_info`, `file_search_content`) while keeping `file_patch`, `git_commit`, `git_push`, `file_trash`, and all GitHub write tools approval-gated. Verified full 5-step developer workflow (`git_repository_info` → `file_search_content` → `file_patch` → `git_diff` → `git_commit`) end-to-end through Python `pixel-agent-v2` in `tests/phase-b-git-files-github.test.ts`.
- **Unverified / Remaining:** Live outbound GitHub API calls with a real PAT, Windows CI green re-run after push, and interactive Electron GUI launch (`0x80000003` pre-entry exit) remain open.

## Phase A — Python Agent Engine (`pixel-agent-v2`) (Committed at `ec61ca0`)

- **Implemented & Verified Locally:** Upgraded Pixel's advisory-only `python/agent_service.py` into a full Hermes-inspired streaming Python agent engine (`python/pixel_agent/` + `python/pyproject.toml`, zero third-party runtime deps, pure Python 3 stdlib HTTP/TLS/JSON/threading) speaking NDJSON protocol `pixel-agent-v2`.
- **Electron Integration & Security:** Upgraded `src/main/services/pythonAgentBridge.ts` (ownership tracking, `.corrupt` quarantine, 4 MiB buffer cap, spawn/exit crash handling), created `src/main/agent/pythonRunner.ts` (keeps Electron's `ToolRegistry` + `PermissionBroker` + `TaskManager` + `AuditLog` as sole privileged authority, automatic pre-turn fallback to TypeScript `AgentExecutor`, no mid-turn mutation replay), wired into `src/main/ipc.ts`, added `agent.runtimeEngine: 'typescript' | 'python'` (default `'typescript'`) in `src/shared/types.ts` and Settings → Advanced (`src/renderer/components/SettingsPanel.tsx`).
- **Verification:** `npm run typecheck` PASS; `npm run build` PASS; `python -m unittest discover -s python\tests -v` **23/23 PASS**; `tests/python-agent-bridge.test.ts` + `tests/python-agent-parity.test.ts` **12/12 PASS** (all 10 parity scenarios + crash safety); full `npm test` **1,004 passed, 27 skipped, 0 failed** (78 passed, 1 skipped). Measured Windows benchmark (Python 3.15.2, local mock SSE): startup 831.7 ms, RSS 23.59 MB, first token 258.0 ms, tool round-trip 38.9 ms, cancel 32.9 ms.
- **Unverified / Open:** Live cloud provider API calls and interactive Electron GUI launch (`0x80000003` pre-entry exit) remain unverified. Detailed report: `docs/architecture/PIXEL_PYTHON_AGENT_PHASE_A.md`. All edits kept local and uncommitted.

## Phase H1 — Hermes Agent Reverse-Engineering & Blueprint (2026-11-23)

- **Research Complete (No Production Code Modified in Phase H1):** Completed 10-pass reverse-engineering of `NousResearch/hermes-agent` at pinned commit `0f602c5f6f18615632535251d62a2db74ce93b69` (MIT, local research clone `C:\dev\pixel-research\hermes-agent`).
- **REA MCP Verified (`6.10.1`):** Bounded `analyze_javascript_application` runs succeeded on Hermes Desktop Electron (`ev_845b4b88b06113608ed413514591952f5137e8f2658c76e58331b87405e534de` / `ev_a1dd461517ef623229ab5ea3a60355fd5ea98c94a3f490cf28cfb6858bfdd939`) and Renderer (`ev_07250be5667d16cb33969a3a7bb250b5968018183af58c8bd73a6b246ced4d05` / `ev_9a9c678827f3b621ee945a9bf9eafb7b453a7d0676e92ec52e1e81ecca4cc904`). Full Python AST + `git ls-files` scan indexed all 27,462 tracked files and registered tools.
- **Permanent Knowledge Base & Blueprint:** Stored under `docs/research/hermes/` (22 documents including `README.md`, `RESEARCH_STATUS.md`, `SOURCE_INVENTORY.md`, `REA_EVIDENCE_INDEX.md`, `TOOL_INVENTORY.json`, subsystem analyses, `HERMES_VS_PIXEL.md`, `PIXEL_TARGET_ARCHITECTURE.md`, `PIXEL_MIGRATION_PLAN.md`, and `IMPLEMENTATION_CHECKLIST.md`).
- **Ready for Phase H2 (Implementation):** Start with Phase A (`pixel-agent-v2` Python agent engine) and Phase B (Git/Files/GitHub completion) per `docs/research/hermes/PIXEL_MIGRATION_PLAN.md`.

## Latest Checkpoint (2026-11-23 — Local Uncommitted)

Latest validation follow-up: the disposable WPF UIA agent workflow passed on
Windows and is documented in `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`.
After the routine-input follow-up, `npm run typecheck` and `npm run build`
passed. `npm test` passed **1,008 tests, 11 skipped, 0 failed** (1,019 total;
77 files passed, 1 skipped). The real Chromium browser suite passed 30/30;
skips include 7 NSIS cases because `makensis` is absent, 3 opt-in foreground
tests, and 1 document symlink case. Pixel's actual Electron GUI remains
unavailable because Electron exits with `0x80000003` before its entry point; no
new GUI acceptance is claimed.

Scheduled workflow follow-up: parameterized active skills can now be scheduled
with values supplied in Skills & Routines. Migration 13 stores values locally;
main-process validation refuses unknown, missing, oversized or credential-like
values, returns only input names across renderer IPC, and redacts values from
task/audit history. Focused plan, scheduler and UI tests pass 20/20. These
routine values are local configuration, not encrypted credentials; users must
not enter secrets. See `docs/architecture/PIXEL_SKILLS_AND_ROUTINES.md` and the
updated 6.2 checklist.

Plugin verification: a fresh direct public read through the GitHub adapter
again failed at DNS resolution (`api.github.com`, `ENOTFOUND`) before HTTPS.
The fixture suite is now 12/12 and includes a regression that records adapter
errors in Plugin Health without returning false success. Live provider and
Plugin Manager desktop verification remain open.

- **Design System & Workspace Redesign (Checkpoint B):**
  - Applied the requested warm matte palette (`#0C0B0A` base, opaque warm surfaces, `#F28A43` restrained accent) in `src/renderer/index.css` and `src/renderer/workspace-design-system.css`. The visual remains flat and opaque, with no frosted panels or colored selection-edge strips. `tests/monochrome-theme.test.ts` now asserts the warm palette and contrast.
  - Consolidated the Workspace into a compact `240px` sidebar: **New Chat**, **Projects**, **Library**, **Pixel Board**, **Running Tasks**, **Recent Chats** (search, rename, delete confirmation, scrollable history, active project indicator), **Notes & Planning**, and **Settings**. Tools, plugins, memory, and routines remain available in Settings categories.
  - Upgraded Settings (`src/renderer/components/SettingsPanel.tsx`) to the **11 approved flat categories**: General, AI & Models, Agent & Permissions, Voice, Memory, Tools, Plugins & Connections, Skills & Routines, Appearance, Workspace, and Advanced (gray selected nav only, flat sections).
  - Redesigned Activity as **Running Tasks** (`src/renderer/components/WorkspaceTasks.tsx`) showing active/queued/waiting/paused/recovering/failed tasks with live elapsed timer and current step; completed tasks move into collapsible Task History.
  - Fixed Windows titlebar controls order in `src/renderer/Workspace.tsx` to **Minimize → Maximize/Restore → Close** (left to right).
- **Pix Ambient Motion (Section 12):**
  - Researched `stackedlol/ascii-sharks` (`fff1af0`, MIT) via REA MCP (`ev_6e6b60bdb2b2a0de7a903a816e3c31d0921d23777fa4a4b9e198275d5e14af3a`) and direct source inspection.
  - Adapted the upstream fixed-step, visibility, resize, pointer, and reduced-motion techniques in `src/renderer/lib/asciiSharks.ts`; replaced the source shark artwork with small, low-contrast constellation glyphs so Pix remains Pixel's mascot. The canvas is pointer-inert, pauses when hidden/off-screen or reduced motion is enabled, and cleans up on unmount (`tests/ascii-sharks.test.tsx`).
- **Agent Mode Scoped Autonomy & Git/GitHub Tools (Checkpoints C & F):**
  - Root cause found in `src/main/agent/tools.ts`: `evaluateInvocation` previously treated `agent` mode identically to `hybrid` mode for `requiresApproval` tools. Added `AGENT_MODE_AUTONOMOUS_TOOLS` for routine bounded Git/GitHub/file/document inspection and safe HTTPS clone in Agent mode while keeping Guide read-only, Hybrid prompting, Emergency Stop paramount, and `critical`/destructive actions always approval-gated.
  - Implemented `src/main/git/toolset.ts` (`git_status`, `git_diff`, `git_log`, `git_branches`, `git_clone`, `git_init`, `git_fetch`, `git_pull`, `git_commit`, `git_push`, `git_revert` via `execFile` with `shell: false`, dirty-tree protection, HTTPS-only clone, no force-push) wired into `ToolExecutors` and `ipc.ts`.
  - Expanded `src/main/plugins/github.ts` with DNS-pinned read-only helpers for files, issues, pull requests, branches, and workflow runs.
- **Hermes / Clicky Research & Python Agent Service Prototype (Checkpoints A, D & E):**
  - Cloned `NousResearch/hermes-agent` (`0f602c5f`), `farzaa/clicky` (`e71105c`), and `stackedlol/ascii-sharks` (`fff1af0`) outside Pixel under `C:\dev\pixel-research\`; documented comparison matrix and REA Evidence IDs in `docs/research/HERMES_CLICKY_REA_RESEARCH.md`.
  - Built advisory-only Python agent service prototype (`python/agent_service.py`, protocol `pixel-agent-v1`) + typed `src/main/services/pythonAgentBridge.ts` preserving Electron's main-process `PermissionBroker` as the sole execution authority (`tests/python-agent-bridge.test.ts`).
  - Improved selective memory (`src/main/memory/autoExtract.ts`) with `relevanceScore`, `confidence`, `isLowValueNoise` filtering, and `filterNovelMemoryCandidates` deduplication (`tests/git-and-agent-autonomy.test.ts`).
- **Remaining / Open Items:**
  - Live Windows GUI visual screenshot acceptance and Electron `0x80000003` local launch diagnostics remain open for a desktop-GUI-capable run.
  - Full Pixel Board UX expansion, additional OAuth/external productivity plugins (Drive/Calendar/Email), and offline Python voice inference packages (`faster-whisper`, `kokoro_onnx`) remain future milestone work.
  - Do not commit or push for the user; all changes are kept locally in the project folder.

## Repository state

- Existing checkout: `C:\Users\cypri\OneDrive\Desktop\cyps`, branch `main`.
- Current committed HEAD and `origin/main`: `4fe3ed658ca8ee59fefba9a19ee0834709b92f5a`, branch `main`. This continuation started from `8288850ac825d5b5c1b79656f1432622a8129bf7` and preserved later committed changes.
- The last confirmed Windows CI run [44916016724](https://github.com/cypskip-create/Pixel/actions/runs/44916016724) passed on `0780c18d22ce1c07ba195527f952ac9cb9f7d37d`, including typecheck, automated tests, native helper compile, package build and artifact upload. CI for current HEAD `4fe3ed6` is unverified. Earlier run [44882229282](https://github.com/cypskip-create/Pixel/actions/runs/44882229282) passed on `8288850`. CI/package builds do not prove interactive installed-app acceptance. Final documentation edits are uncommitted and not covered by those runs.
- A fresh `npm run dev` retry built main/preload and the native helper, preserved the occupied 5199 listener, started Vite on 5200, then Electron exited `2147483651` (`0x80000003`) without a targetable window. Follow-up isolation: direct `electron.exe --version` exited with the same code before printing a version, both from this checkout and from the read-only `C:\dev\Pixel` binary; their executable SHA-256 hashes match. A Computer Use launch timed out, and a fresh desktop inventory still showed no Pixel window. No `%TEMP%\Pixel` startup log was created, confirming the process did not reach Pixel's boot logger. Existing `%APPDATA%\Pixel` data was read-only and left untouched. This does not establish a source defect; GUI acceptance remains blocked by the current host runtime.
- Do not commit or push for the user.

## Current checkpoint

Core Tools 6.2 remains open. The 6.3 bundled plugin foundation and read-only
public GitHub metadata plugin predate this continuation. This checkpoint
implements the first warm matte Workspace pass: semantic warm tokens, grouped
navigation plus existing conversation history, project search/grid/list over
local records, and reduced-motion/visibility-aware decorative Pix glyphs. New
source and tests are present in the current local commit; final documentation
updates remain uncommitted. See
`docs/research/PIXEL_REFERENCE_RESEARCH_6_3.md` and
`docs/architecture/PIXEL_DESIGN_TOKENS.md`.

The latest full `npm run verify` before the final design pass passed **994
tests, 11 skipped, 0 failed** (1,005 total; 74 files passed, 1 skipped). After
the final palette and route updates, typecheck and production build passed;
focused Workspace tests passed 32/32 and theme plus ambient tests passed 11/11.
`scripts/test.mjs` selects the matching Chromium revision
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
The latest disposable WPF UIA fixture run passed the full agent path: exact
window selection, approved `ValuePattern` entry/read-back, approved
`TogglePattern` state/read-back, approved button invocation, explicit
postcondition verification and SQLite task-history restoration. It exposed an
8-turn agent ceiling that stopped before the verification turn; the bounded
ceiling is now 12 and the regression run passed. This is native-helper and
agent integration evidence, not acceptance of Pixel's actual Electron window.
See `docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md` for the artifact and remaining
GUI blockers.
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
