# Pixel Windows acceptance procedure

This is the manual gate for behavior that type checks and headless tests cannot prove. On 2026-11-16, Electron's Chromium GUI failed before creating a window (`-2147483645`). No orb, conversation UI, task strip, approval card, cursor-follow behavior or installer lifecycle passed acceptance here. Treat every GUI and distribution step below as unverified until run on an interactive Windows desktop. See [PIXEL_RELEASE_READINESS.md](PIXEL_RELEASE_READINESS.md) for exact local evidence, test totals and the current commit.

## Automated checks before opening Pixel

Run from the repository root in a normal Windows PowerShell session:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run build:native
```

Capture a reproducible local evidence bundle from the repository root:

```powershell
$artifactDir = Join-Path $PWD 'artifacts\windows-acceptance'
New-Item -ItemType Directory -Force $artifactDir | Out-Null
git rev-parse HEAD | Set-Content (Join-Path $artifactDir 'commit.txt')
npm ci 2>&1 | Tee-Object (Join-Path $artifactDir 'npm-ci.log')
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npx playwright install chromium 2>&1 | Tee-Object (Join-Path $artifactDir 'playwright-install.log')
if ($LASTEXITCODE -ne 0) { throw 'Playwright install failed' }
npm run typecheck 2>&1 | Tee-Object (Join-Path $artifactDir 'typecheck.log')
if ($LASTEXITCODE -ne 0) { throw 'Type check failed' }
npm test -- --reporter=default --reporter=junit --outputFile.junit="$artifactDir/vitest-junit.xml" 2>&1 | Tee-Object (Join-Path $artifactDir 'tests.log')
if ($LASTEXITCODE -ne 0) { throw 'Test suite failed' }
npm run build 2>&1 | Tee-Object (Join-Path $artifactDir 'build.log')
if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }
npm run build:native 2>&1 | Tee-Object (Join-Path $artifactDir 'native-build.log')
if ($LASTEXITCODE -ne 0) { throw 'Native helper build failed' }
```

Then capture the GUI and package checks with these commands. Stop `npm run dev` with Ctrl+C after observing the app; this expected stop is not a test failure.

```powershell
npm run dev 2>&1 | Tee-Object (Join-Path $artifactDir 'dev.log')
npm run pack 2>&1 | Tee-Object (Join-Path $artifactDir 'pack.log')
if ($LASTEXITCODE -ne 0) { throw 'Unpacked package build failed' }
npm run dist 2>&1 | Tee-Object (Join-Path $artifactDir 'dist.log')
if ($LASTEXITCODE -ne 0) { throw 'Windows distribution build failed' }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-windows.ps1 -Launch 2>&1 | Tee-Object (Join-Path $artifactDir 'windows-validation.log')
if ($LASTEXITCODE -ne 0) { throw 'Windows validation failed' }
```

Keep the generated JUnit XML, `release` distributions and `validation-report-*.json` with the logs.

Build and inspect the unpacked app and installer with the pinned electron-builder 26 setup:

```powershell
npm run pack
npm run dist
```

`npm run pack` builds the unpacked Windows app. `npm run dist` builds the NSIS installer, portable executable and ZIP; both commands explicitly disable publishing. Save command output and the test report under an acceptance artifact folder. GitHub Actions uploads CI logs, JUnit test results and build artifacts from the Windows job.

If the build host sets `ELECTRON_RUN_AS_NODE`, remove it in that shell before testing Electron. Do not change system security settings to work around a launch failure.

## Launch and shell checks

1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-windows.ps1 -Launch`.
2. Start the development build with `npm start` or launch `release/win-unpacked/Pixel.exe` after packaging. In this Codex environment, do not treat an Electron exit before window creation as an application pass; use a normal interactive desktop.
3. Verify the floating orb, tray menu, global shortcut, settings, expand/collapse, drag, emergency stop, focus behavior and restart persistence.
4. Repeat on every attached display, including 125%/150% scaling, negative-coordinate monitor layouts, unplug/replug and taskbar positions.
5. Record the generated `validation-report-*.json`, OS build, display topology and DPI. A missing window, bad bounds or lost tray entry is a failure, not an assumed pass.
6. In Settings, select **Follow cursor**. Confirm the compact orb follows without covering the pointer, stays within each display's work area, pauses while expanded, and returns to its remembered position when stationary mode is restored. Repeat with reduced motion and mixed DPI.

The repository's previous environment report explains why a sandboxed Electron/Chromium process may fail before Pixel code runs: [Electron constraints](../ELECTRON-CONSTRAINTS.md). Treat that report as environment-specific; verify on the target laptop.

## Ordered first-release validation

Run these checks in order and record a pass only after observing the behavior or artifact directly:

1. **Electron development launch:** run `npm run dev` in an interactive PowerShell window. Save its output. Record whether Electron stays alive and emits a clean startup log.
2. **Main, renderer and preload:** inspect the startup log for main-process stages, renderer load and preload bridge readiness. Confirm no preload or renderer errors appear.
3. **Visible orb:** confirm the floating orb appears, stays on top and does not steal focus.
4. **Conversation UI:** expand the orb, send a harmless prompt and confirm the conversation surface renders and accepts input.
5. **Task strip and approval cards:** run a harmless action task; inspect its current step/status in the task strip and confirm the approval card names the action and scope before approving it.
6. **Cursor-follow mode:** complete the display, edge-clamp, expanded pause and return-to-stationary checks above.
7. **Native-helper task:** run the harmless UIA fixture procedure below and inspect the task's persisted outcome and verification evidence.
8. **Unpacked app:** run `npm run pack`, launch `release\win-unpacked\Pixel.exe`, and repeat the orb, conversation, approval, cursor and UIA checks.
9. **Portable executable:** launch `release\Pixel-Portable-0.2.1.exe` and repeat the core checks. Confirm no install registration is created.
10. **Clean NSIS install:** install `release\Pixel-Setup-0.2.1.exe` into a clean test profile; confirm shortcuts, launch and use the app.
11. **Existing-install upgrade:** install over the previous Cyps identity and confirm the same install location is upgraded and settings, conversation history and encrypted credentials remain available.
12. **Uninstall and user data:** uninstall through Windows Apps/Programs. Confirm the app is removed and `%APPDATA%\Pixel` plus any retained `%APPDATA%\cyps` migration backup remain intact.

Record failed steps as failures and blocked steps as unverified. Do not infer GUI success from a zero exit code or package creation.

## Task-state acceptance

Use a disposable test folder and check the actual app:

1. Start a short safe task. Confirm the compact task strip shows its objective and current step.
2. Pause during model work and while an approval card is open. Confirm no new tool begins after pause; resume and confirm it continues once.
3. Cancel during a controllable operation. Confirm the task ends Cancelled and no later tool runs.
4. Approve a file creation in the test folder. Confirm the file is reopened and its content matches before Pixel reports it verified.
5. Ask for a harmless browser action and verify the page's expected text. Confirm the source URL is reported.
6. Deny an action and confirm the target does not change.
7. Close Pixel while a task is waiting for approval. Restart and confirm the task is paused with a recovery note, the approval did not survive and no action restarted.
8. Complete a state-changing operation with no available postcondition. Confirm Pixel reports that it needs verification rather than showing Completed.

Automated tests cover the SQLite store, interrupted-task recovery, safe-point pause/resume, cancellation, stale approval ids, argument validation, file read-back and worker termination. They do not replace these app-level checks.

## Native desktop and human-handoff checks

Start the harmless, uniquely accessible Windows Forms fixture in a separate PowerShell window:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\start-uia-fixture.ps1
```

The fixture only changes its own label between `Pixel harmless action: pending` and `Pixel harmless action: completed`; **Reset fixture** restores the initial state. It does not access files, the network, credentials or other applications. Keep it in the foreground while running each task.

For a deterministic main-process integration check, build and run:

```powershell
npm run test:native-uia-e2e
```

This invokes the real helper and AgentExecutor against the fixture, has the test harness grant one-use approvals through Pixel's PermissionBroker, and writes a JSON result plus the durable SQLite task/event database under `artifacts\windows-acceptance\`. It does not display Pixel's approval cards. Complete the actual UI checks below separately before calling the desktop workflow accepted.

1. Ask Pixel to read the foreground title. Approve the read and confirm it reports `Pixel UIA Harmless Fixture`.
2. Ask Pixel to search for the unique button `Run harmless UIA action`. Approve the search and confirm the returned role/name and bounds match the fixture.
3. Ask Pixel to invoke that exact button with expected postcondition `Pixel harmless action: completed` present in the same window. Confirm the approval card shows the exact title, selector and postcondition. Confirm the completion text was absent before action. Approve the action once.
4. Approve the fresh UIA verification request. Confirm the action step becomes verified only after the completion text is observed, the task records its outcome/evidence, and the task strip reports completion.
5. Press **Reset fixture** and repeat with a different window focused after observation; the action must be refused and the fixture must remain pending.
6. Start a separate harmless task and cancel it while it is still running. Confirm its state becomes Cancelled and no later tool action occurs.
7. Start a task and close Pixel while it waits at an approval. Restart Pixel. Confirm the task is paused with a recovery note, the old approval is absent and the fixture remains unchanged.
8. Test a duplicated selector and an inaccessible/custom control. Ambiguous or unsupported controls must fail without acting.
9. Trigger human takeover for an authentication/verification step. Confirm Pixel releases its input lease, waits for explicit Continue, does not treat acknowledgement as proof, and observes before continuing.

These steps exercise the actual Pixel approval card and durable task UI. A direct helper call or unit test does not substitute for them.

## Security and voice checks

- Verify the API key is stored only in the encrypted credential file and cannot be read back through renderer APIs or logs.
- Test a credential-looking value in a task request, memory save and skill draft; confirm it is rejected/redacted and never appears in persisted task args.
- Inspect, correct, delete and export project memory. Confirm the export contains only the active project scope.
- Review and activate a harmless skill, run it once through the task gateway, then schedule a local daily routine. Verify run history, missed occurrence behavior, cancellation and failure pause. Confirm restart does not replay a run.
- Open a public site that redirects to localhost/private IP. Confirm Pixel refuses to expose the resulting page. The current guard checks after the connection; this does not prove the private connection never began.
- Check local voice capabilities using `node scripts/diagnose.mjs`. Test only the speech capabilities that the current Windows probe reports; the diagnostics result is machine-specific and does not prove microphone behavior in Pixel's UI.
- Confirm the companion does not record or transmit screenshots continuously.

## Distribution checks

On a test profile, validate unpacked launch, portable launch, clean install, upgrade over the previous Pixel identity, uninstall and user-data preservation. Do not use the account's only data copy. Preserve the existing appId, NSIS GUID and legacy `%APPDATA%\cyps` migration behavior. Attach `scripts/diagnose-installer.ps1` output and startup logs when a case fails. SmartScreen reputation and signing status must be reported as observed; never promise them from a build artifact.

## Report template

```text
Windows version/build:
Pixel commit/tree state:
Package tested (source/unpacked/portable/installer):
Displays and scaling:
Commands and automated totals:
GUI steps passed/failed:
Artifacts/log paths:
```
