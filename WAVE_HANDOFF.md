# Pixel implementation handoff

Updated: 2026-11-17

## Active work: UI Experience 2.0

- Dedicated local branch: `codex/ui-experience-2`, starting at
  `0be3ba45b5b94a2018969670490a8c9b6ad8e80b`.
- Checkpoint 1 implements the single measured companion panel stack and one
  accessible mode selector. It has not yet been visually accepted on the
  target laptop.
- Current branch validation and commit identity will be recorded in the latest
  checkpoint section below. Historical validation counts below describe the
  tree before this branch and are not the current totals.
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

## Delivered in this tree

- Durable SQLite task snapshots/events, Zod contracts, conservative restart recovery, pause/resume/cancel, task budgets, verification evidence and a compact execution timeline.
- Cancellation propagation through browser, Python/voice workers, child process trees and the native UIA helper; emergency stop also stops queued routine work.
- Scoped, one-shot high-risk approvals; prompt-injection data framing; exact-window title checks before Windows text input and native UIA invocation.
- Human takeover state with explicit acknowledgement and a required fresh observation before any later mutation.
- Compiled and connected C# UI Automation helper for foreground-window information, bounded semantic element search, exact unique enabled `InvokePattern` invocation, and exact present/absent postcondition checks. Timed-out/cancelled helpers are boundedly terminated; unconfirmed exit quarantines future calls and retains the desktop-input lease.
- Optional cursor-follow presentation using spring motion and work-area clamping; it is independent of intelligence mode and pauses while expanded.
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
- UI/settings: `src/renderer/components/AutomationPanel.tsx`, `MemoryPanel.tsx`, `TaskStrip.tsx`, `SettingsPanel.tsx`, `src/renderer/App.tsx`.
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

## Current branch Git status

Branch: `codex/ui-experience-2`. Checkpoint commits are local only; no push or release is requested.
