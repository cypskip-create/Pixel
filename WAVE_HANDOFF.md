# Pixel implementation handoff

Updated: 2026-11-18

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
