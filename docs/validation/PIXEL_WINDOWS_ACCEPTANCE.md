# Pixel Windows acceptance procedure

This is the manual gate for behavior that type checks and headless tests cannot prove. On 2026-11-16, the C# helper compiled and its foreground/UIA query paths ran, but Electron's Chromium GUI failed before creating a window (`-2147483645`). The unpacked package build also failed when electron-builder could not resolve `github.com` to fetch its Windows signing/edit helper. No app window, tray, packaged executable, installer, microphone, display/DPI, upgrade or uninstall behavior passed acceptance here.

## Automated checks before opening Pixel

Run from the repository root in a normal Windows PowerShell session:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run build:native
```

To exercise the optional browser integration suite, install Chromium once:

```powershell
npx playwright install chromium
npm test
```

Build and inspect the unpacked app and installer with the pinned electron-builder 26 setup:

```powershell
npm run pack
npm run dist
```

If the build host sets `ELECTRON_RUN_AS_NODE`, remove it in that shell before testing Electron. Do not change system security settings to work around a launch failure.

## Launch and shell checks

1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-windows.ps1 -Launch`.
2. Start the development build with `npm start` or launch `release/win-unpacked/Pixel.exe` after packaging. In this Codex environment, do not treat an Electron exit before window creation as an application pass; use a normal interactive desktop.
3. Verify the floating orb, tray menu, global shortcut, settings, expand/collapse, drag, emergency stop, focus behavior and restart persistence.
4. Repeat on every attached display, including 125%/150% scaling, negative-coordinate monitor layouts, unplug/replug and taskbar positions.
5. Record the generated `validation-report-*.json`, OS build, display topology and DPI. A missing window, bad bounds or lost tray entry is a failure, not an assumed pass.
6. In Settings, select **Follow cursor**. Confirm the compact orb follows without covering the pointer, stays within each display's work area, pauses while expanded, and returns to its remembered position when stationary mode is restored. Repeat with reduced motion and mixed DPI.

The repository's previous environment report explains why a sandboxed Electron/Chromium process may fail before Pixel code runs: [Electron constraints](../ELECTRON-CONSTRAINTS.md). Treat that report as environment-specific; verify on the target laptop.

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

1. On a harmless test window such as a blank Notepad document, ask Pixel to read the foreground title. Confirm a screen-approval card appears.
2. Search for a benign accessible control name. Confirm the returned role, AutomationId, bounds and truncation flag match the observed UIA tree.
3. Request an accessible control invocation. Confirm the approval card names the expected foreground title, exact action selector and expected present/absent UIA state. Confirm the expected state was initially false, approve only a harmless control, then approve the read-only verification request and confirm Pixel observes the matching state before reporting completion.
4. Change focus after an observation but before approval. Confirm the C# helper refuses the invocation when the live title no longer matches. For text entry, confirm the Windows child process rechecks the title immediately before sending keys.
5. Test a duplicated selector and an inaccessible/custom control. Ambiguous or unsupported controls must fail without acting.
6. Trigger human takeover for an authentication/verification step. Confirm Pixel releases its input lease, waits for explicit Continue, does not treat acknowledgement as proof, and observes before continuing.

## Security and voice checks

- Verify the API key is stored only in the encrypted credential file and cannot be read back through renderer APIs or logs.
- Test a credential-looking value in a task request, memory save and skill draft; confirm it is rejected/redacted and never appears in persisted task args.
- Inspect, correct, delete and export project memory. Confirm the export contains only the active project scope.
- Review and activate a harmless skill, run it once through the task gateway, then schedule a local daily routine. Verify run history, missed occurrence behavior, cancellation and failure pause. Confirm restart does not replay a run.
- Open a public site that redirects to localhost/private IP. Confirm Pixel refuses to expose the resulting page. The current guard checks after the connection; this does not prove the private connection never began.
- Check local voice capabilities using `node scripts/diagnose.mjs`. Try dictation and TTS with both installed and unavailable capabilities; Pixel must report unavailable speech honestly.
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
