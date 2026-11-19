# Pixel release readiness

> Historical report. Its dark-UI restoration evidence predates the latest
> Experience Polish 5.0 working tree. For the current SHA, tests, CI status and
> Windows acceptance commands, use
> [`PIXEL_EXPERIENCE_POLISH_5_READINESS.md`](PIXEL_EXPERIENCE_POLISH_5_READINESS.md).

**Reviewed:** 2026-11-18 (original dark companion restoration)
**Version:** 0.2.1
**Branch:** `codex/ui-experience-2`
**Restoration base:** `0da5b8b53c0bd8fe0ba38106c794456e0a9d50d1` (this focused restoration change)
**Decision:** Pixel is **not release-ready** until the restored floating UI is visually checked on Windows and the packaged GPU path is validated.

## Current local evidence — restored dark floating UI

- The floating companion restores the reference commit's navy fills (`0.88` primary, `0.95` raised), border colors and shadow stack. Both native windows use system backdrop `none` on Windows. All CSS backdrop filters, Acrylic/Mica settings and Acrylic-specific variables/query mode are removed. The redesign-only Island gradient and toolbar capsule are removed. P logo, controls, layout, Workspace layout and dark colors are retained.
- `npm run typecheck`: passed. `npm test -- --reporter=default`: **721 passed, 0 failed, 26 skipped (747 total; 39 files: 38 passed, 1 skipped)**. The skips are 17 browser tests without Playwright Chromium, 7 NSIS tests without `makensis`, and 2 opt-in native foreground tests.
- `npm run build`: passed (main TypeScript, bundled preload, Vite renderer and icon). `git diff --check`: passed.
- `npm run test:preload-sandbox`: **unverified**. Electron 45.2.3 exits with `2147483651` (`0x80000003`) before a smoke report is created. See `artifacts/windows-acceptance/preload-sandbox-smoke.log`.
- The branch contains CI fixes for the observed run 7 (`44159366265`, PR #9 merge SHA `9ee0298fe4dcc738cf264f9b60b9673fd47e65d7`): Python 3.12 is provisioned for the document tests, and worker startup uses bounded polling. The old run had 10 document tests fail on a hard-coded developer interpreter path and one fixed-sleep cancellation race; native compilation and packaging were skipped. The workflow needs a push to rerun these changes.
- Before this rollback, DWM readback showed Pixel Acrylic (type 3) and Workspace Mica (type 2) on build `26300.9974`. The restored build has not been visually launched or read back. Both window configurations now request no system backdrop.
- White-page, dark-page and desktop screenshots were not captured. The existing visible Pixel process belongs to inaccessible `C:\dev\Pixel`; port 5199 was occupied, and this environment's Electron child process exited before startup when run from the writable checkout. The visual acceptance procedure remains outstanding; do not describe this rollback as visually accepted yet.
- Existing Electron/Chromium Crashpad child-process failures remain separate and do not prove the GPU issue's cause on the user's laptop. No GPU driver report or post-restoration packaged launch is available.
- Follow [`PIXEL_WINDOWS_ACCEPTANCE.md`](PIXEL_WINDOWS_ACCEPTANCE.md) for white webpage, dark webpage, desktop, interaction and packaged checks. No installer or native helper build was part of this visual restoration.

Historical checkpoint results later in this report refer to earlier repository states; their test totals and package evidence are superseded by this current section.

## Previous UI Experience 2.0 evidence (historical)

- `npm run typecheck`: passed for renderer and main TypeScript projects.
- Focused UI/history/search tests: **69 passed across 8 files**.
- Full Vitest suite: **712 passed, 0 failed, 26 skipped across 36 files (738 tests total)**. Browser tests need Playwright Chromium, installer tests need NSIS, and the native foreground integration suite is opt-in.
- A later repeat was interrupted before Vitest returned a result; the count above is the most recent completed run.
- `npm run build`: passed (main TypeScript, esbuild sandbox preload, Vite renderer).
- `git diff --check`: passed after the documentation edits.
- `npm run test:preload-sandbox`: blocked before the smoke app starts. Electron 45.2.3 exited with `2147483651` (`0x80000003`); the log contains no main-entry marker and no smoke JSON was written, so bridge assertions did not run. The harness now clears stale output and records launcher metadata plus Electron stderr.
- An isolated `electron-builder --win --dir --publish never` run targeting `release/ui-experience-2-validation` failed before creating output because `getaddrinfo ENOTFOUND github.com`. No existing `release` artifact was overwritten.
- The Windows GUI attempt was stopped before an application was selected. No native layout, search-browser launch, restart, unpacked app or installer behavior is claimed as passed.
- Remote GitHub `main` is `0be3ba45b5b94a2018969670490a8c9b6ad8e80b`; the GitHub connector returned no status checks for it and no PR-triggered workflow run for the local branch. The reported preload-smoke CI failure has no retrievable Actions log in this session. This runner reproduces a pre-main Electron exit, but it does not establish the remote failure cause. `npm run test:preload-sandbox` remains the laptop/CI repro command.

### UI defect causes corrected

- The mode selector was mounted in both `InputBar` and `App`, producing duplicate menus.
- The native BrowserWindow retained a small fixed active-surface size. CSS stacking could not display a menu or response outside that native window's bounds.
- UI panels measured and positioned themselves independently, so combined responses, task and approval content could clip or overlap.
- The primary window reused saved arbitrary coordinates that cursor-follow could update, so returning to stationary mode could leave the bar off its intended anchor.
- The response surface reported speech before playback was confirmed, and the screenshot and attachment labels did not match their actual capture/upload targets.

The current architecture uses one measured panel stack and a display-anchored
primary window. The optional cursor follower is a separate passive BrowserWindow.
Recent Chats and search use the existing main-process history store and typed
preload contract; default-browser search uses a validated provider URL built in
main. See [UI architecture](../architecture/PIXEL_UI_ARCHITECTURE.md) and the
[Windows acceptance checklist](PIXEL_WINDOWS_ACCEPTANCE.md).

## Laptop-side commands

Run these from the repository root on a connected Windows development machine.
The package commands write to `release`; if existing artifacts must be kept,
use the isolated output command in the acceptance guide.

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run build:native
npm run test:preload-sandbox
npm run dev
npm run pack
npm run dist
```

The sections below are historical evidence for the earlier preload repair and
must not be read as validation of the UI Experience 2.0 tree.

## Previous preload-checkpoint notes (historical)

- The local branch was clean at task start at the base commit shown above.
- The focused preload repair is committed locally at the user's request. No push, tag or release was created; the resulting commit SHA is reported in the final response.
- `appId` remains `com.cyps.companion`; the pinned NSIS GUID remains `a5745318-c98a-51f9-87f5-f1c32713b276`. User-data migration and installer repair scripts were not changed.
- `npm run pack` and `npm run dist` both use `--publish never`. The GitHub Actions workflow builds and uploads artifacts only; it does not publish.

## Implemented and verified

- `npm run typecheck` passed for the renderer and main TypeScript projects.
- The final Vitest run passed **655 tests across 26 files, with 0 failures and 0 skips**. It included all 22 Chromium browser tests and all 9 NSIS tests.
- `npm run build` passed. `npm run build:native` compiled `PixelNative.exe` with the Windows .NET Framework compiler. `npm run pack` produced the unpacked Windows app.
- Esbuild reported the complete preload runtime graph as `src/preload/index.ts` plus `src/shared/channels.ts`; Electron is the only external require. The unpacked `app.asar` preload is byte-for-byte identical to the generated preload and has no local CommonJS import.
- Native-helper tests cover cancellation, timeout, unexpected crash/restart, sibling-call failures, quarantine after an unconfirmed kill, and retaining the desktop-input lease until process exit.
- The deterministic UIA test harness is implemented. It uses the real `AgentExecutor`, one-use `PermissionBroker` approvals, `ToolExecutors`, postcondition checks and SQLite task/event persistence. Its test-only approval callback is not a visible Pixel approval card.
- `.github/workflows/windows-ci.yml` runs Windows type checking, Chromium and NSIS tests, the sandboxed preload IPC smoke, native compilation and non-publishing distributions. It uploads command logs, smoke/JUnit reports and build artifacts for 14 days. This workflow was not run for this local commit.

The final test output is in [`artifacts/windows-acceptance/vitest-junit.xml`](../../artifacts/windows-acceptance/vitest-junit.xml). A first sandboxed run could not reach its local browser fixture; the final complete run used the authorized environment that allowed loopback access.

## Partially implemented

- UIA invocation verifies only a specified accessible control's exact present/absent state in the same titled foreground window. It does not read arbitrary values, set form values, or operate inaccessible/custom controls.
- Voice uses local Windows System.Speech with runtime capability probes. Probe results differed by execution context, so this report makes no fixed STT/TTS availability claim. Microphone and voice UI behavior remain unverified.
- Skills are model-mediated without deterministic interaction recording/replay. Specialist coordination is not connected to an independent model-backed delegation loop.
- Interrupted tasks recover as paused and require review; Pixel does not resume the old model call stack automatically.

## Unverified release gates

| Check | Evidence and status |
| --- | --- |
| Electron development launch and startup logs | The user reports a later Windows run successfully reached the window and painted React. In this Codex environment the Electron smoke executable exited with `2147483651` before app startup logs. |
| Sandboxed preload bridge and IPC | Bundle graph and packaged file verified, but `window.cyps`/`window.cypsShell` injection and IPC calls were not observed in a running Electron renderer here. `npm run test:preload-sandbox` is the laptop smoke command. |
| Orb, conversation, task strip, approval cards and cursor following | A reported React paint does not verify these behaviors; inspect and record each on the target laptop. |
| Harmless real-control UIA action through Pixel | Not run. The fixture process stayed alive, but it could not be surfaced as the foreground window in this desktop session. The harness stopped before invoking any control. |
| Unpacked application launch | `release/win-unpacked/Pixel.exe` and `app.asar` were built; package preload bytes match the bundled output. The desktop launch timed out with no Pixel window, so runtime launch is unverified here. |
| Portable launch, clean install, existing-install upgrade, uninstall and data preservation | Not run for this preload checkpoint; validate on a disposable target profile. |
| GitHub Actions result | Workflow is configured but cannot run until pushed or manually dispatched from GitHub. |

The first default-sandbox test run failed two local-browser cases with `ERR_NETWORK_ACCESS_DENIED` and skipped browser setup cases; after allowing loopback access and installing Chromium, the final full run passed with no skips. This was an execution restriction, not a changed browser assertion.

The earlier GPU/renderer child-process failure is separate from the preload dependency failure. Existing environment notes describe Chromium/Crashpad failures before the renderer and do not confirm a root cause. The preload repair does not claim to resolve packaged GPU behavior; keep `--disable-gpu` as a development diagnostic until the target-laptop GPU path is tested.

## Distribution artifacts

`npm run pack` exited successfully with publishing disabled. It produced
`release/win-unpacked/Pixel.exe`, `app.asar` containing the bundled preload and
`resources/native/PixelNative.exe`. The packaged preload is 10,123 bytes and
matches `dist/main/preload/index.js` byte-for-byte. `npm run dist` was not run
for this checkpoint; previous installer sizes are not current evidence. No
code-signing certificate is configured, and artifact creation does not prove
that the app launches or that SmartScreen will trust it.

## Laptop-side acceptance

Run the full ordered procedure in [`PIXEL_WINDOWS_ACCEPTANCE.md`](PIXEL_WINDOWS_ACCEPTANCE.md). The key commands are:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run test:preload-sandbox
npm run build
npm run build:native
npm run dev
npm run pack
npm run dist
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-windows.ps1 -Launch
```

For the harmless native control, first run `powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\start-uia-fixture.ps1` and keep that fixture foregrounded. Then run `npm run test:native-uia-e2e` for the deterministic backend check, followed by the actual Pixel approval-card/task procedure in the acceptance guide. The harness writes a JSON report and SQLite task/event database under `artifacts\windows-acceptance\`.

Save the Git SHA, command logs, JUnit report, `validation-report-*.json`, OS/display details, and pass/fail notes for each GUI and installer step. Do not mark a blocked GUI step as passed.

## Missing capabilities

- General credential broker for service logins and secure form fill.
- Deterministic desktop interaction recorder/replay and generalized postcondition language.
- Independent model-backed specialist delegation, VirtualBox/SSH execution and Pixel Code.
- Automated continuation after restart; recovery is review-and-restart by design.
