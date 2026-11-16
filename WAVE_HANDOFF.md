# Pixel implementation handoff

Updated: 2026-11-16

## Delivered in this tree

- Durable SQLite task snapshots/events, Zod contracts, conservative restart recovery, pause/resume/cancel, task budgets, verification evidence and a compact execution timeline.
- Cancellation propagation through browser, Python/voice workers, child process trees and the native UIA helper; emergency stop also stops queued routine work.
- Scoped, one-shot high-risk approvals; prompt-injection data framing; exact-window title checks before Windows text input and native UIA invocation.
- Human takeover state with explicit acknowledgement and a required fresh observation before any later mutation.
- Compiled and connected C# UI Automation helper for foreground-window information, bounded semantic element search, exact unique enabled `InvokePattern` invocation, and exact present/absent postcondition checks. UIA actions remain pending until a matching postcondition is observed.
- Optional cursor-follow presentation using spring motion and work-area clamping; it is independent of intelligence mode and pauses while expanded.
- Project memory inspection, correction, deletion and JSON export; versioned skill drafts/review/activation/run history; durable daily routines with missed-run skip, serialization, cancellation, failure pause and one-time manual retry.
- Tests cover task recovery, approval/cancellation paths, memory UI operations, skills and routines, UIA tool policy/argument validation, and browser/file/document/worker behavior.
- Refreshed current-state report, Grok Bot mapping, Clicky mapping, runtime/security/skills documentation, Windows acceptance procedure, README and PROGRESS.

## Important files

- Agent/task/policy: `src/main/agent/`, `src/main/tasks/`, `src/main/agents/coordinator.ts`, `src/main/agent/inputLease.ts`.
- Native Windows helper and build: `native/PixelNative/PixelNative.cs`, `src/main/services/nativeHelper.ts`, `scripts/build-native.ps1`.
- Skills/routines/memory: `src/main/skills/`, `src/main/routines/`, `src/main/memory/`.
- UI/settings: `src/renderer/components/AutomationPanel.tsx`, `MemoryPanel.tsx`, `TaskStrip.tsx`, `SettingsPanel.tsx`, `src/renderer/App.tsx`.
- Packaging: `electron-builder.yml` copies `native/bin/PixelNative.exe` to `resources/native/PixelNative.exe`; `pack` and `dist` build the helper first.
- Tests: `tests/tasks.test.ts`, `agent-executor.test.ts`, `native-agent-tools.test.ts`, `skills-routines.test.ts`, `memory.test.ts`, `safety.test.ts` and the existing browser, file, document and provider suites.

## Validation performed

- Latest after the UIA postcondition changes: `npm run typecheck`, `npm run build`, `npm run build:native`, and `git diff --check` passed.
- The full suite had passed earlier: **619 passed, 24 skipped** across 25 files. It was not rerun after the final UIA postcondition changes. Earlier skips: 17 browser cases because Playwright Chromium is absent and 7 NSIS cases because `makensis` is absent.
- Earlier direct Windows checks passed for protocol ping, foreground window, UIA search and title-mismatch refusal. The added postcondition path compiled but was not exercised against a real UI control.
- Windows `type_text` mismatch check — passed through the real PowerShell child process; it returned `DENIED` and sent no text.
- `npm run pack` — attempted twice, failed at electron-builder's GitHub download (`getaddrinfo ENOTFOUND github.com`). No newly packaged app is validated.
- Electron GUI launch — attempted with an isolated workspace-local profile and exited before creating a window (`-2147483645`), matching the sandbox limitation in [ELECTRON-CONSTRAINTS.md](docs/ELECTRON-CONSTRAINTS.md). No profile data was written.
- No code, checkpoint commit, push, installer, release or worktree was created.

## Remaining work and limits

- Run GUI and packaged acceptance on a normal Windows desktop with network access. Validate cursor mode, tray, focus, mixed DPI, screen capture, UIA providers and installer identity/upgrade/uninstall.
- Native UIA reads accessible names/AutomationIds, checks exact present/absent states and invokes one exact unique enabled `InvokePattern`; it does not type, set form values or operate inaccessible/custom controls. It verifies only within the same exact titled foreground window and can report an empty process name for some desktop providers.
- Skills are user-reviewed and model-mediated. There is no interaction recorder, automatic save-from-task prompt or deterministic live semantic replay runner.
- Specialist roles/coordinator are foundations, not independent model-backed delegations in the live task flow. VirtualBox/SSH and Pixel Code are unavailable.
- There is no general credential broker. Passwords, MFA, passkeys, CAPTCHA and payment confirmation remain human tasks.
- Restart recovery asks the user to review and start a new task; it does not continue the old model call stack. A task acknowledgement does not prove the handoff action succeeded.
- Browser private-network checks detect some unsafe connections after the connection begins; preventing the network request itself requires a controlled egress proxy.

## Git

Branch: `main`. The implementation and documentation changes remain uncommitted, as requested. The user will commit and push.
