# Pixel Windows acceptance procedure

This is the manual gate for behavior that type checks and automated tests cannot prove. The user reports that Pixel now starts on the target Windows laptop and its sandbox preload smoke test passes. This procedure includes the focused foreground-context integration. Record only behavior observed directly on the tested machine; see [PIXEL_RELEASE_READINESS.md](PIXEL_RELEASE_READINESS.md) for local build and test evidence.

## Automated checks before opening Pixel

Run from the repository root in a normal Windows PowerShell session:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run test:preload-sandbox
npm run build
npm run build:native
```

`test:preload-sandbox` launches a hidden Electron window with `sandbox`,
`contextIsolation`, `nodeIntegration: false` and `webSecurity` enabled. It checks
`window.cyps` and `window.cypsShell`, Settings IPC, task and permission events,
permission responses, shell events, and the absence of raw Node/IPC globals. It
uses harmless stub IPC handlers and a test-only API-key placeholder. It writes
`artifacts\windows-acceptance\preload-sandbox-smoke.json` and
`preload-sandbox-smoke.log` on success. A failure before the Electron app starts
is an environment failure, not a pass.

## Floating glass and task status comparison

The supplied screenshot is the pre-repair state. Do the comparison on the
target laptop and record a fresh screenshot for each run. Close Pixel normally
between runs so the single-instance lock does not redirect a launch to the old
process.

1. Test the default Windows Acrylic path, with the existing GPU-disabled
   development diagnostic:

   ```powershell
   Remove-Item Env:PIXEL_GLASS_MODE -ErrorAction SilentlyContinue
   npm run dev
   ```

2. Stop the process with `Ctrl+C`, confirm Pixel has exited, then compare the
   opaque CSS fallback:

   ```powershell
   $env:PIXEL_GLASS_MODE = 'fallback'
   npm run dev
   ```

3. Stop it, clear the override, and separately test the normal GPU path:

   ```powershell
   Remove-Item Env:PIXEL_GLASS_MODE -ErrorAction SilentlyContinue
   npm run dev:gpu
   ```

Check that the P mark is unchanged; Recent Chats, the composer and toolbar read
as related surfaces; text and controls remain legible over both dark and bright
desktop content; edges and shadows stay subtle; and Acrylic does not leave a
visible rectangular patch outside the rounded island. Open Settings, an
approval card and the task strip to check their elevated surfaces. If a task has
a pending postcondition, the strip must say **Needs verification** and must not
count that step as verified. Do not infer a successful visual result from CSS
build output alone.

The override affects only the launched process. It does not change stored Pixel
settings. `npm run dev` still passes `--disable-gpu`; `npm run dev:gpu` omits it
and is the separate GPU comparison. Do not add `--no-sandbox` or loosen the
BrowserWindow security flags during either run.

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
npm run test:preload-sandbox 2>&1 | Tee-Object (Join-Path $artifactDir 'preload-sandbox.log')
if ($LASTEXITCODE -ne 0) { throw 'Electron sandbox preload smoke test failed' }
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
3. Verify the floating orb, tray menu, global shortcut, settings, expand/collapse, emergency stop, focus behavior and restart persistence. Confirm the main bar cannot be dragged away from its anchor.
4. Repeat on every attached display, including 125%/150% scaling, negative-coordinate monitor layouts, unplug/replug and taskbar positions.
5. Record the generated `validation-report-*.json`, OS build, display topology and DPI. A missing window, bad bounds or lost tray entry is a failure, not an assumed pass.

## Pinned bar and cursor companion acceptance

1. Start Pixel. Confirm the main pill is centered on the selected display and its top edge is 10–14 logical pixels below the work-area top. Expand the bar, open the mode selector and show a response/task panel; verify the center and top edge remain fixed.
2. In Settings, select **Move to display** for every connected monitor. Confirm the bar moves to that display's work-area center. Restart Pixel and confirm the selected display is retained.
3. Move **Top offset** between 10 px and 14 px. Confirm the bar follows the value without changing its horizontal center.
4. Enable **Show cursor companion**. Confirm a separate orb follows while the top bar stays fixed. Click through the orb onto a harmless underlying control and verify the cursor window did not receive focus or intercept the click.
5. Move the pointer near each work-area edge and across mixed-DPI monitors, including one left of the primary display. Confirm the follower stays inside the pointer's current display work area.
6. Expand the bar and open an approval card. Confirm the follower pauses at its last position. Collapse to idle and verify it resumes.
7. Enable reduced motion and confirm the cursor orb moves directly to each safe target without spring animation. Disable the cursor companion and confirm its window disappears without moving the pinned bar.
8. Unplug the selected monitor. Confirm Pixel moves to the primary display and persists that fallback. Reconnect it, select it again and confirm restart behavior.

Do not use old drag-position or **Follow cursor** steps: those controls were
replaced by display anchoring and a separate passive cursor window. Automated
geometry and settings tests do not prove native click-through or mixed-DPI
behavior on a real desktop.

The repository's previous environment report explains why a sandboxed Electron/Chromium process may fail before Pixel code runs: [Electron constraints](../ELECTRON-CONSTRAINTS.md). Treat that report as environment-specific; verify on the target laptop.

## Workspace and supplied P mark acceptance

Use the interactive Windows app after the development launch, then repeat the
relevant checks with the unpacked build:

1. Confirm the geometric P appears in the collapsed island, toolbar lockup,
   composer, assistant response, Settings, Workspace, tray icon and Windows
   app icon. Compare the cyan/aqua/white blocks and central sparkle cutout with
   the supplied logo reference. The tray and app icon may use different
   backgrounds, but must use the same P geometry.
2. Open **Pixel Workspace** from the island toolbar, the tray menu and the
   configured `CommandOrControl+Shift+P` shortcut. Confirm these open/focus the
   same Workspace window rather than creating duplicate assistant sessions.
3. Resize Workspace, move it, maximize it, restore it and restart Pixel.
   Confirm the last usable bounds and maximized state are restored on the
   correct display and remain on-screen after a display is disconnected.
4. Start a harmless conversation in the island and continue it in Workspace;
   then send a reply in Workspace and verify the island receives the same
   active conversation and response stream. Confirm saved conversation history
   is identical from both surfaces when history persistence is enabled.
5. Start one harmless task and confirm both surfaces show the same task state.
   Request an approval, approve or deny it from either surface, and confirm the
   result is reflected in both. Trigger emergency stop and confirm it applies
   to the one shared task and does not leave a second agent running.
6. Change a Settings value or API-key status and confirm the other open
   surfaces update without showing or exposing the secret. Confirm projects,
   tools, memory and skills/routines panels load their existing data.
7. Close Workspace with its native close control. Confirm the island and tray
   remain available; reopen Workspace and confirm the prior conversation is
   still active.

These checks require a real Electron desktop. Renderer screenshots or unit
tests alone do not prove multi-window synchronization, focus behavior, native
window restoration, tray rendering or Windows backdrop support.

## Separate packaged GPU diagnosis

The earlier packaged GPU/renderer child-process failure is separate from the
preload and Workspace changes. Test the normal packaged GPU path without adding
`--disable-gpu` to the launch command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\capture-startup.ps1 -Exe .\release\win-unpacked\Pixel.exe -Seconds 20 -Report .\artifacts\windows-acceptance\packaged-gpu-startup.txt
```

Record the process exit code, whether a top-level window appeared, `pixel-startup.log`,
Chromium/GPU child-process output, Windows version and GPU driver. Compare with
the development diagnostic launch only as a separate run; the dev script keeps
`--disable-gpu`, while production and packaged builds retain the normal GPU
path. Do not call the issue fixed based on the preload smoke or a successful
build. Preserve both logs if the packaged app fails before `ready-to-show`.

## Preload bridge acceptance

The compiled preload must be a single bundled file at
`dist\main\preload\index.js`. The build and pack steps verify that its local
runtime dependency graph is bundled and that the unpacked `app.asar` contains
the same preload. On the target laptop, also run `npm run test:preload-sandbox`
and require a JSON report with `"ok": true`. This uses a real Electron
sandboxed `BrowserWindow` and harmless stub IPC handlers; it does not modify app
settings or contact DeepSeek.

Then run `npm run dev` and inspect the Electron startup log and renderer console.
There must be no preload error or missing-native-bridge warning. In the renderer
console, run:

```javascript
({
  cyps: typeof window.cyps,
  settingsGet: typeof window.cyps?.settings?.get,
  tasks: typeof window.cyps?.tasks?.onUpdate,
  permissions: typeof window.cyps?.permissions?.respond,
  shell: typeof window.cypsShell?.voiceCapability,
  settings: await window.cyps?.settings?.get(),
  hasApiKey: await window.cyps?.settings?.hasApiKey(),
})
```

Expect `cyps` to be `"object"`, each listed method to be `"function"`, Settings
to return its configuration without a key value, and `hasApiKey` to be boolean.
Open Settings and confirm it loads. Under **Privacy → API key**, use **Add Key**
to save a disposable DeepSeek test key if no key is configured; do not replace
an existing key. Confirm the status changes to **Configured**, restart Pixel,
and confirm it remains configured without the key being shown. Select **Test
Connection** and confirm the result matches the provider response. Never paste
the key into DevTools, logs or task text. With a configured key, send the
harmless prompt `Reply exactly: PIXEL BRIDGE TEST OK` and verify the response
appears.
Check permission cards and the emergency stop with a harmless test task. Repeat
the preload/Settings smoke on `release\win-unpacked\Pixel.exe`; confirm the
startup log has no `preload-error` and the bridge methods are available there.
Keep `--disable-gpu` as a development diagnostic; this bridge check does not
verify packaged GPU behavior.

## Ordered first-release validation

Run these checks in order and record a pass only after observing the behavior or artifact directly:

1. **Electron development launch:** run `npm run dev` in an interactive PowerShell window. Save its output. Record whether Electron stays alive and emits a clean startup log.
2. **Main, renderer and preload:** inspect the startup log for main-process stages, renderer load and preload bridge readiness. Confirm no preload or renderer errors appear.
3. **Visible orb:** confirm the floating orb appears, stays on top and does not steal focus.
4. **Conversation UI:** expand the orb, send a harmless prompt and confirm the conversation surface renders and accepts input.
5. **Task strip and approval cards:** run a harmless action task; inspect its current step/status in the task strip and confirm the approval card names the action and scope before approving it.
6. **Cursor companion:** complete display selection, edge-clamp, passive click-through, active-surface pause, disable and restart checks above.
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

## External foreground context acceptance

The foreground observer captures only window metadata (HWND stays inside the
native helper/main process); it does not take screenshots or persist an
observer history. The active task holds the opaque target identity in memory
only while matching an approved action to its postcondition. `get_foreground_window` continues to describe the
current foreground window. `get_last_external_foreground_window` reports the
last non-Pixel foreground window held in memory. The read tools still go
through Pixel's explicit permission flow. If multiple windows could match a
requested target, use `list_external_windows` and ask the user to select the
exact window before searching or acting. Pixel never switches applications on
its own.

On the target laptop, use a harmless Notepad document, a VS Code editor window
with no unsaved changes, and a browser tab without a form or sensitive content:

1. Start Pixel. Open Notepad, focus its document, then switch to Pixel's orb and
   open the conversation. Ask, “Which application was active immediately before
   Pixel?” Approve the metadata read and require the exact Notepad process/title.
2. Repeat with VS Code and the browser. Open Pixel Settings as a second Pixel
   window, focus each Pixel window in turn, and verify both remain excluded
   while the same external app is reported.
3. With an external app recorded as last active, close that app without
   focusing another external app first. Ask Pixel again. It must report the
   target as stale/closed and must not offer it as a valid action target.
4. Record an external app, minimize it, and inspect the returned metadata. It
   must show `isMinimized`; UIA search, verification and invocation must refuse
   to treat hidden controls as available. Restore the window and re-observe.
5. Start a read-only observation and deny its permission. Confirm no tool call
   runs. Start another and cancel it while approval is pending; confirm it does
   not execute afterward.
6. For a state-changing UIA check, select one exact window/control, approve the
   named action, and verify the expected postcondition in that same window
   identity. Change focus or close/reopen the target before approval and confirm
   Pixel refuses the stale target without switching applications.
7. Keep screenshots/capture permission unused during these checks. Confirm the
   app's capture log/event is absent; foreground tracking should continue using
   title, process, bounds and timestamps only.

For a helper-level interactive check, build first and run in a Windows Terminal
PowerShell tab while Pixel is open. The terminal PID is excluded because
returning to the prompt changes foreground context. The manual script verifies
metadata, configured Pixel/terminal process exclusion and stale detection; it
does not exercise Pixel's visible permission card:

```powershell
$repoPath = [regex]::Escape((Resolve-Path .).Path)
$pixel = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('Pixel.exe', 'electron.exe') -and
  $_.CommandLine -match $repoPath -and $_.CommandLine -notmatch '--type='
} | Select-Object -First 1
if (-not $pixel) { throw 'Could not identify the running Pixel main process.' }
$terminal = Get-Process WindowsTerminal -ErrorAction Stop | Select-Object -First 1
$env:PIXEL_HOST_PIDS = "$($pixel.ProcessId),$($terminal.Id)"
npm run build:native
npm run build:main
node scripts/test-native-foreground-manual.mjs notepad
node scripts/test-native-foreground-manual.mjs Code
node scripts/test-native-foreground-manual.mjs brave
```

Replace `brave` with the process name for the browser installed on the test laptop (for example, `msedge`, `chrome` or `firefox`) when needed.

For each run, focus the named application, switch to Pixel, then return to the
terminal. The helper should still identify the application because both Pixel
and Windows Terminal process IDs are excluded. When prompted, close the
target, return to the terminal and require `closed-target-marked-stale`. Save
terminal output with the other Windows acceptance artifacts. If using a
different terminal, replace its process ID in `PIXEL_HOST_PIDS` with the PID
that owns its visible top-level window.

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

## UI Experience 2.0 — Checkpoint 1 panel-layout acceptance

Run these steps in an interactive Windows session after building the current
branch. The geometry unit tests are not a substitute for this visual check.

1. Start Pixel from the checked-out project with `npm run dev`; confirm there
   is one companion window and no renderer/preload error.
2. Expand the input and open the mode selector. Confirm exactly one selector
   appears, all three modes and descriptions are visible, and the panel is not
   clipped by the native window.
3. Use arrow keys and Home/End to move selection, then Escape. Confirm the menu
   closes and focus returns to the mode trigger. Reopen it and click elsewhere
   in Pixel; confirm it closes. Reopen it and switch focus to another app;
   confirm native focus loss closes it without refocusing Pixel.
4. Display a long response and open a running task or approval card alongside
   the other visible panels. Confirm they stack without overlap. If the stack
   exceeds available work-area height, confirm the Pixel panel scrolls and
   clicks outside the actual native bounds reach the underlying application.
5. Repeat at 1366×768 and the available 1920×1080/2560×1440 display sizes, at
   100%, 125% and 150% scaling, including a secondary monitor with negative
   coordinates where available. Record the monitor arrangement and scaling.
6. Save a screenshot of the expanded mode selector and the combined response/
   task or approval layout. Record any clipping, overlap, click interception,
   scrollbar placement or focus-return failures.

The 2026-11-17 branch run passed the geometry and DOM interaction tests, but
has not yet produced a screenshot from this rebuilt branch. Treat all listed
native visual/DPI/monitor steps as **unverified** until they are completed on
the laptop.

## UI Experience 2.0 — pinned bar, history and search acceptance

Run these checks after `npm run build` and `npm run build:native`, then repeat
the package checks against the unpacked Windows application. The automated
layout, renderer and history tests do not prove native Electron window
placement, Windows default-browser handling or restart persistence on the
target profile.

1. Start `npm run dev`. Confirm the primary bar appears centered 10–14 logical
   pixels below the selected display work-area top. Expand and collapse it,
   open Settings, Recent Chats and the mode selector, and change modes. Confirm
   the bar's horizontal center and top anchor stay fixed, the mode selector
   appears once, panels fit inside the native window, and long content scrolls
   inside Pixel.
2. In Settings, select another attached display and restart Pixel. Confirm the
   selected display is retained. Unplug that display and confirm Pixel falls
   back to the primary display without opening off-screen.
3. Enable the cursor companion. Move the pointer across the display and onto a
   second monitor if available. Confirm it follows independently, does not
   steal focus or intercept clicks, and pauses while the main bar is active.
   Disable it and confirm it disappears while the primary bar remains in the
   same anchored position.
4. With `privacy.persistHistory` enabled, create two conversations and send a
   harmless prompt to each. Confirm each conversation continues with its own
   context, the Recent Chats panel shows the right title and preview, search
   finds a term in the transcript, rename works, and confirmed delete removes
   only the selected conversation. Restart Pixel and restore each saved chat.
   Confirm no API key, reasoning trace, tool arguments or image payload appears
   in the user-facing transcript storage.
5. Disable `privacy.persistHistory`, create a conversation and send a harmless
   prompt. Confirm it is available in the current session but does not create
   or update a persisted history record. Re-enable persistence and verify new
   messages save normally.
6. Select Google, Bing and DuckDuckGo in Settings in turn. For an explicit
   request such as “Search the web for electric cars — Nairobi”, confirm the
   Windows default browser opens the configured provider with the complete,
   correctly encoded query. Repeat with Unicode and punctuation. Pixel should
   report that it opened the results page, without claiming that it read the
   results.
7. Ask an ordinary question such as “What is a search engine?” Confirm no
   browser opens. In Hybrid/Agent mode, ask the model to open a search and deny
   or cancel the permission; confirm no browser launch occurs. Confirm an
   allowed, approved search opens only the selected provider URL.
8. Check response scrolling and collapsed reasoning, speech feedback after
   actual playback, screenshot labeling/target, task completion/failure
   dismissal and the compact Settings layout. Confirm dismissal does not erase
   task history, and that the emergency stop still cancels active work.
9. Build and inspect the unpacked app before portable or installer validation.
   Confirm it shows the same pinned bar and loads Recent Chats, Settings and
   browser search. Then validate portable launch, clean install, upgrade,
   uninstall and user-data preservation on a disposable profile.

For a validation run that does not replace any existing files in `release`,
write the unpacked build to a new directory and retain the complete log:

```powershell
npx electron-builder --win --dir --publish never --config.directories.output=release/ui-experience-2-validation
```

Record the OS build, display arrangement/scaling, persistence setting, selected
search provider, default browser, exact commands, pass/fail/blocked result for
each item, and paths to screenshots/logs. Do not mark any GUI, installer or
restart check passed unless it was observed directly on that Windows profile.

### Current checkpoint environment result (2026-11-17)

- `npm run typecheck`, `npm run build`, `npm run build:native` and the Electron
  runtime version check passed. The full suite passed **718 tests, 0 failed,
  26 skipped (744 total across 37 files)**. Skips: 17 browser cases due to
  unavailable Chromium, 7 NSIS cases due to missing `makensis`, and 2 opt-in
  foreground integration cases. The Chromium download failed DNS resolution
  for `cdn.playwright.dev`.
- The isolated package attempt reached Windows packaging, then failed because
  electron-builder could not resolve `github.com` (`ENOTFOUND`); no app output
  was produced. Existing `release` artifacts were preserved.
- The sandboxed Electron smoke exited `2147483651` (`0x80000003`) before the
  smoke app entry point, so it did not verify bridge calls in this run.
- Windows GUI, Workspace, backdrop, display behavior, packaged app, portable
  build and installer acceptance remain unverified. The packaged GPU issue is
  a separate, unresolved diagnosis; use the command in the section above.

### Local and laptop validation commands

Run these in the repository root on a network-connected Windows development
machine. The full installer command writes to the standard `release` folder;
use the isolated command above if existing artifacts must be preserved.

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run ensure:electron-runtime
npm run build
npm run build:native
npm run test:preload-sandbox
npm run dev
npm run pack
npm run dist
```

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
