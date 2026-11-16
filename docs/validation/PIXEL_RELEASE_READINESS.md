# Pixel release readiness

**Reviewed:** 2026-11-16  
**Version:** 0.2.1  
**Branch:** `main`  
**Current commit:** `82cee19b1f23415edd3a2bd430efa743d7fcdb6f`  
**Decision:** Source, tests and Windows package builds are verified. Pixel is **not yet release-ready** because the interactive app, live approval flow, and installer lifecycle could not be exercised in this desktop session.

## Baseline and integrity

- The local branch was clean at task start. The GitHub `main` ref independently reported the same commit SHA shown above; the local fetch could not update `.git/FETCH_HEAD` in this sandbox.
- All edits remain uncommitted. No commit, push, tag, worktree or release was created.
- `appId` remains `com.cyps.companion`; the pinned NSIS GUID remains `a5745318-c98a-51f9-87f5-f1c32713b276`. User-data migration and installer repair scripts were not changed.
- `npm run pack` and `npm run dist` both use `--publish never`. The GitHub Actions workflow builds and uploads artifacts only; it does not publish.

## Implemented and verified

- `npm run typecheck` passed for the renderer and main TypeScript projects.
- The final Vitest run passed **651 tests across 25 files, with 0 failures and 0 skips**. It included 22 Chromium browser tests and all 9 NSIS tests.
- `npm run build` passed. `npm run build:native` compiled `PixelNative.exe` with the Windows .NET Framework compiler.
- `npm run pack` and `npm run dist` passed. The unpacked package contains `Pixel.exe` and `resources/native/PixelNative.exe`; the Playwright test browser cache is excluded.
- Native-helper tests cover cancellation, timeout, unexpected crash/restart, sibling-call failures, quarantine after an unconfirmed kill, and retaining the desktop-input lease until process exit.
- The deterministic UIA test harness is implemented. It uses the real `AgentExecutor`, one-use `PermissionBroker` approvals, `ToolExecutors`, postcondition checks and SQLite task/event persistence. Its test-only approval callback is not a visible Pixel approval card.
- `.github/workflows/windows-ci.yml` runs Windows type checking, Chromium and NSIS tests, native compilation and non-publishing distributions. It uploads command logs, JUnit XML and build artifacts for 14 days. This workflow was added but has not run from this uncommitted tree.

The final test output is in [`artifacts/windows-acceptance/vitest-junit.xml`](../../artifacts/windows-acceptance/vitest-junit.xml). A first sandboxed run could not reach its local browser fixture; the final complete run used the authorized environment that allowed loopback access.

## Partially implemented

- UIA invocation verifies only a specified accessible control's exact present/absent state in the same titled foreground window. It does not read arbitrary values, set form values, or operate inaccessible/custom controls.
- Voice uses local Windows System.Speech with runtime capability probes. Probe results differed by execution context, so this report makes no fixed STT/TTS availability claim. Microphone and voice UI behavior remain unverified.
- Skills are model-mediated without deterministic interaction recording/replay. Specialist coordination is not connected to an independent model-backed delegation loop.
- Interrupted tasks recover as paused and require review; Pixel does not resume the old model call stack automatically.

## Unverified release gates

| Check | Evidence and status |
| --- | --- |
| Electron development launch and startup logs | Vite started; Electron exited before main-process startup logs or window creation with `2147483651` (signed `-2147483645`). |
| Renderer/preload, orb, conversation, task strip, approval cards and cursor following | Not observed because Electron did not create a window. |
| Harmless real-control UIA action through Pixel | Not run. The fixture process stayed alive, but it could not be surfaced as the foreground window in this desktop session. The harness stopped before invoking any control. |
| Unpacked/portable application launch | Package files built; neither executable was successfully launched in the GUI. |
| Clean install, existing-install upgrade, uninstall and data preservation | Installer artifacts built; lifecycle behavior was not run. |
| GitHub Actions result | Workflow is configured but cannot run until pushed or manually dispatched from GitHub. |

The first default-sandbox test run failed two local-browser cases with `ERR_NETWORK_ACCESS_DENIED` and skipped browser setup cases; after allowing loopback access and installing Chromium, the final full run passed with no skips. This was an execution restriction, not a changed browser assertion.

## Distribution artifacts

`npm run dist` exited successfully and produced:

| Artifact | Size |
| --- | ---: |
| `release/Pixel-Setup-0.2.1.exe` | 124,616,958 bytes |
| `release/Pixel-Portable-0.2.1.exe` | 113,113,043 bytes |
| `release/Pixel-Windows-Unpacked-0.2.1.zip` | 157,549,247 bytes |
| `release/win-unpacked/Pixel.exe` | 249,831,936 bytes |
| `release/win-unpacked/resources/native/PixelNative.exe` | 16,384 bytes |

No code-signing certificate is configured; electron-builder reported signing skipped. Artifact creation does not prove that the app launches or that SmartScreen will trust it.

## Laptop-side acceptance

Run the full ordered procedure in [`PIXEL_WINDOWS_ACCEPTANCE.md`](PIXEL_WINDOWS_ACCEPTANCE.md). The key commands are:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
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
