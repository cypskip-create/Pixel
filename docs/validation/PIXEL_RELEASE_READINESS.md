# Pixel release readiness

**Reviewed:** 2026-11-17
**Version:** 0.2.1  
**Branch:** `main`  
**Repair base commit:** `6a62de336cf2005aa8ddd0b745dabd3a53674de0`
**Decision:** TypeScript, automated tests, source build, native helper and unpacked package are verified. Pixel remains **not yet release-ready** because the sandboxed bridge was not observed in a live Electron renderer here, and packaged-app acceptance still needs the target laptop.

## Baseline and integrity

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
