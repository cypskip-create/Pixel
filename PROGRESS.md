# Pixel progress (formerly Cyps)

Updated: installer preflight fix + startup diagnostics. Product name **Pixel**; version **0.2.0**.

## Current milestone

**Windows installer repair and rebrand to Pixel** - complete in code, built into
three distributions, and verified as far as a headless environment allows.
On-device GUI verification is still outstanding and is the gate for Wave 3.

Waves 1A-1D are preserved: floating shell, DeepSeek streaming, agent tool loop,
browser automation, voice, and the security model are unchanged.

## Round 2: preflight rejection and silent startup (latest)

Two defects were reported from the laptop. Both are fixed; the second is
diagnosable now even where it cannot be reproduced.

### 1. Installer rejected a writable directory

`%LOCALAPPDATA%\Programs\Pixel` was demonstrably writable from PowerShell, yet the
installer showed the "cannot write" dialog, and changing the location changed
nothing.

Cause: the check sat in `.onVerifyInstDir`, which MUI calls **while the path is
being typed**. It raised a modal dialog from inside that callback, called `Abort`
(which can leave a valid directory rejected), and clobbered `$0` without saving
it, a register the page code uses.

Fix: `.onVerifyInstDir` removed entirely. Validation runs once in `customInit`
through `build/dir-check.nsh`, where the **file-creation attempt is the only
authority** and `CreateDirectory`'s result is ignored. A writable directory never
prompts. Registers are pushed and popped.

Verified by `tests/nsis.test.ts`, which compiles the real macro with makensis and
executes it: existing directory, not-yet-existing directory, trailing separator
and trailing-backslash cases all pass; a nonexistent drive is rejected; no probe
file is left behind. 11 tests, all passing. The harness also proved the old logic
passes those same cases, so the fault was *when* the callback ran, not the write
test.

### 2. Silent startup failure

Nothing appeared: no window, no `%APPDATA%\Pixel\pixel-startup.log`, no event-log
entry.

Structure changed so this cannot be silent again:

- `src/main/startup/boot.ts` loads **first** and imports only Node built-ins. It
  writes a log line, mirrors everything to stderr, and installs handlers for
  uncaught exceptions, unhandled rejections, signals and `process.exit`.
- `src/main/main.ts` now does one thing: start boot logging, then `await
  import('./app')` inside a try/catch. A failure anywhere in the dependency graph
  is recorded instead of vanishing. (Previously the whole app was imported
  statically, so an import-time failure produced exactly the reported symptom.)
- The log location falls back `%APPDATA%\Pixel` -> `%APPDATA%\cyps` ->
  `%TEMP%\Pixel` -> `%USERPROFILE%\Pixel-logs` -> working directory, and the chosen
  path is written as the first log line so it can be found.
- A `pixel-last-exit.json` marker records the exit code.
- `Pixel.exe --pixel-selfcheck` runs without a window: it verifies the main
  bundle, preload, renderer entry, Electron initialisation, user-data
  writability, and reports `ELECTRON_RUN_AS_NODE`, then writes
  `pixel-selfcheck.json` next to the log (GUI stdout is unreliable) and exits with
  a meaningful code.
- The window now shows itself after 8 seconds even if `ready-to-show` never
  fires, and logs that it did, so a renderer that fails to paint cannot leave an
  invisible process.

Bugs found while building this, all fixed:
- the self-check resolved its bundle directory one level too deep and reported
  every file as missing;
- `await import('electron')` compiles to a `__importStar` wrapper that loses
  Electron's API, producing a false "Electron did not initialise"; it now uses a
  direct `require`, which is correct for the CommonJS bundle;
- GUI-subsystem executables are not attached to the parent console, so the JSON
  report is written to a file as well as stdout.

`scripts/capture-startup.ps1` ties it together on Windows: it runs the self-check,
launches the GUI with `--enable-logging --log-file=...`, waits, then reports the
exit code, whether a window exists and its bounds, always-on-top and layered
styles, the startup log from every possible location, the exit marker, the
Chromium log, and a plain-language verdict.

### What is still uncertain

The packaged executable could not be exercised here: in this environment it
produces no log and no event-log entry at all, and Chromium cannot initialise
(`app.whenReady()` faults with `0xc0000005`). That is the same wall documented
before, not new evidence about the laptop. The **development** bundle does run and
its self-check passes end to end, which is why the diagnostics are trustworthy.
Whether the laptop failure was Electron failing before our code, a Node-mode
environment variable, or a missing resource will be answered by
`capture-startup.ps1` on the next run.

## Distributions

| File | Size | What it is |
| --- | --- | --- |
| `release/Pixel-Setup-0.2.1.exe` | 118.3 MB | NSIS installer, per-user, no admin prompt |
| `release/Pixel-Portable-0.2.1.exe` | 107.5 MB | Portable build, runs without installing |
| `release/Pixel-Windows-Unpacked-0.2.1.zip` | 149.6 MB | Unpacked app + Electron runtime, extract and run |

Install: run the setup, then launch Pixel from the Start menu.
Portable: double-click; nothing is installed.
ZIP: extract, then run `Pixel.exe`. This is the recommended first test because it
bypasses NSIS entirely.

## Installer failure investigation

The reported error was "Cyps cannot be closed. Please close it manually and click
Retry to continue", with no process visible and `taskkill` finding nothing.

**Verified** (by reading electron-builder 26.18.0, the pinned version):

- That exact string is emitted from **three** different places:
  process check (`allowOnlyOneInstallerInstance.nsh:156`), a `CopyFiles` failure
  into the install directory (`extractAppPackage.nsh:116`), and a failed old
  uninstaller during upgrade (`installUtil.nsh:219`). Only the first involves a
  running application, so the message is not trustworthy evidence.
- With PowerShell present, the process check matches by
  `$_.Path.StartsWith($INSTDIR)` rather than by executable name, and cannot see
  elevated processes (their `Win32_Process.Path` is empty).
- This version already contains the exact-name `findstr /B` fix
  ([#6865](https://github.com/electron-userland/electron-builder/issues/6865),
  [PR #9784](https://github.com/electron-userland/electron-builder/pull/9784)),
  so the upstream substring-match bug is not our cause.
- [PR #6547](https://github.com/electron-userland/electron-builder/pull/6547) is
  what introduced the extract-then-copy stage whose failure raises the dialog.
- Our custom NSIS include really is compiled: an intentional error in
  `build/installer.nsh` aborted the build from that file.

**Not verified** - which path actually fired on the laptop. This environment
cannot run the GUI installer, so the laptop's state could not be inspected.
Most likely, in order: a partial Cyps installation whose uninstaller is missing
or unusable (retries then fail forever, exactly as observed), or a locked or
unwritable target directory.

Full analysis: `docs/INSTALLER-TROUBLESHOOTING.md`.

### Fixes applied

1. `build/installer.nsh` defines `customCheckAppRunning` (a supported
   electron-builder hook): exact image-name match for `Pixel.exe` and legacy
   `Cyps.exe` only, current-user scoped, bounded retries, and a message that
   explains the real possibilities instead of looping silently. Detection is
   precise, not disabled.
2. `.onVerifyInstDir` tests writability as soon as a directory is chosen and
   returns the user to the page with an accurate message, so an unwritable path
   never reaches the misleading copy-failure dialog.
3. Installation identity pinned (`appId` unchanged,
   `nsis.guid: a5745318-c98a-51f9-87f5-f1c32713b276`) so Pixel upgrades over
   Cyps in place. A test asserts the pin equals the derivation.
4. Upgrade removes only the stale `Cyps.exe` and old `Cyps.lnk` shortcuts, and
   only after `Pixel.exe` exists. No script touches `%APPDATA%`.
5. `scripts/diagnose-installer.ps1` added: read-only report of processes,
   install locations, uninstall entries, shortcut targets, startup log, event
   log and partial-install detection.

## Rebranding

Product name, executable, installer, shortcuts, tray, window titles, settings,
assistant identity and documentation now say Pixel. `Pixel Code` is reserved and
not implemented.

Deliberately unchanged: `appId`, the uninstall GUID, `CypsBridge` /
`CypsError` / `CypsErrorCode`, `window.cyps`, `cyps:` IPC channels, `CYPS_*`
environment variables, `--cyps-*` CSS properties. See `docs/REBRANDING.md`.

User data: pinned to `%APPDATA%\Pixel`, migrated by copy from `%APPDATA%\cyps`
(or `%APPDATA%\Cyps`), with the source left untouched as a backup.

## First-launch reliability

- `app.setName('Pixel')` and an explicit `userData` path, resolved before the
  settings store is created.
- Migration runs before anything reads settings, and reports itself in the log.
- Startup log at `%APPDATA%\Pixel\pixel-startup.log`: version, data directory,
  migration outcome, tray/shortcut/IPC completion, quit, and failures.
- Handlers for `uncaughtException`, `unhandledRejection`,
  `render-process-gone`, `child-process-gone`, `did-fail-load` and
  `preload-error` all write to that log before anything exits.

Desired first launch is unchanged and still the design: orb near the top of the
screen, click to expand a 480 px bar, add the DeepSeek key in Settings, chat, and
collapse back to the orb - tray-resident, no dashboard, no sidebar.

## Verification status

| Check | Result |
| --- | --- |
| `tsc` main program | pass |
| `tsc` renderer program | pass |
| `vitest` (12 files) | **255 tests pass** |
| `vite build` | pass |
| NSIS installer build | pass (`Pixel-Setup-0.2.1.exe`) |
| Portable build | pass (`Pixel-Portable-0.2.1.exe`) |
| Unpacked ZIP build | pass (`Pixel-Windows-Unpacked-0.2.1.zip`) |
| ZIP contains `Pixel.exe` + `resources/app.asar` | pass (central-directory read in tests) |
| Installer script compiled | pass (include proven by a deliberate compile error) |
| `diagnose-installer.ps1` | ran: read-only, found the recorded Electron crash in the event log |
| `validate-windows.ps1` | ran: 4 pass, 1 warn, window checks skipped (no process) |
| **Installing, launching and using the GUI** | **not verifiable here** |

The development machine still cannot start any Chromium GUI process
(`app.whenReady()` faults with `0xc0000005`; the packaged app exits on Chromium's
crash handler). Nothing in this document claims the window, tray, shortcuts,
drag, capture or the installer UI were exercised. `docs/WINDOWS-VALIDATION.md` is
the procedure for doing that on the laptop.

## Tests added this milestone

`tests/packaging.test.ts` (32 tests): identity pin and GUID derivation, artifact
naming and targets, per-user + no-data-loss settings, installer-script safety
(exact-name matching, current-user scoping, no `RMDir /r`, no data deletion), and
the full user-data migration matrix including corrupt/partial legacy installs and
copy failures.

`tests/artifacts.test.ts` (11 tests): the three distributions exist with the
documented names, no artifact is named after the old product, the unpacked tree
contains `Pixel.exe`/`app.asar`/runtime files and no `Cyps.exe`, and the ZIP's
central directory lists the executable and resources. Includes a hand-built ZIP
to prove the reader itself is correct.

## Remaining issues

- Installer UI, window, tray, global shortcuts, drag, DPI and screen capture still
  need on-device verification.
- Playwright's Chromium is not bundled; browser tools report a capability error
  until `npx playwright install chromium` is run once.
- No code signing certificate; SmartScreen may warn on first run.
- Typing into elevated windows is blocked by Windows integrity levels.
- Audit trail is in memory only (execution history is persisted).

## Next step

1. Install `Pixel-Setup-0.2.1.exe` on the laptop; if it fails, run
   `scripts/diagnose-installer.ps1` and attach the report.
2. Confirm the first-launch experience and complete
   `docs/WINDOWS-VALIDATION.md`.
3. Only then start Wave 3.
