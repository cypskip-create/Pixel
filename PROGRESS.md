# Pixel progress (formerly Cyps)

Updated: installer preflight fix + startup diagnostics. Product name **Pixel**; version **0.2.0**.

## Current milestone

**Windows installer repair and rebrand to Pixel** - complete in code, built into
three distributions, and verified as far as a headless environment allows.
On-device GUI verification is still outstanding and is the gate for Wave 3.

Waves 1A-1D are preserved: floating shell, DeepSeek streaming, agent tool loop,
browser automation, voice, and the security model are unchanged.

## Round 4: companion engine foundation and safety (latest)

Branch `merge/round4-onto-main`. See `docs/HANDOFF.md` for resume steps,
`docs/research/CLICKY_TO_PIXEL_ARCHITECTURE.md` for the Clicky comparison and
`docs/research/CLICKY_SOURCE_DEEP_DIVE.md` for source-level notes.

**Verified in this build (merged onto `main` at `2e7d11a`):** both type checks are clean;
554 unit tests pass, 32 are skipped (need Chromium), 11 fail. The same 11 fail identically on
an untouched checkout of `main` in the build sandbox (10 document-indexing tests that need a
Python worker environment, and 1 Windows-specific voice test), so they are not caused by this
work, but they have not been run on the laptop either.
**NOT verified:** any Windows GUI behaviour, the C# helper, the repair script, packaging.

- Safety: origin/app-scoped approvals; `AbortSignal` cancellation that kills child processes
  and closes the browser; `NetworkGuard` (all DNS records, every request incl. redirects,
  connected-address check); JSONL audit with redaction; Chromium sandbox on for Windows.
- Companion: `shared/companion/{stateMachine,geometry,cursorFollow,pointing,pushToTalk}.ts`.
  The orb vocabulary and `deriveAssistantState` come from `shared/companion-state.ts` (landed
  on `main` separately); the state machine delegates its priority to that function and a test
  asserts they agree for every combination, so there is one priority definition.
- Settings: `visualMode`, `followSpeed`, `cursorOffset`, `animations`, `transientMode`,
  `transientIdleMs`, all validated and clamped.
- Native: `PixelNative.cs` (UI Automation, read-only) and its TS client. Uncompiled.

**Release blockers (unchanged):** nothing in the installer or startup path has been verified
on a real Windows desktop. The release is not shipped.

## Round 3: stale install state, agent-path bugs, repo hygiene

Reported: installer still failed on 0.2.1 ("cannot be closed", then "Error opening
file for writing ... Uninstall Pixel.exe"). Root cause found in the electron-builder
templates: the upgrade path runs the *registered* old uninstaller and ignores the
chosen folder - see `docs/INSTALLER-TROUBLESHOOTING.md` (Round 3).

- `scripts/repair-install-state.ps1` (PowerShell + a C# Restart Manager call):
  read-only report by default; `-Apply` does a backed-up, user-approved cleanup of
  installer state only. **Not yet run on Windows.**
- **Agent path never sent the system prompt** and never bounded context. Fixed:
  `buildAgentMessages`, `clipToolResult` (12k chars per tool result).
- `type_text` fed text to `SendKeys` unescaped (`% ^ + ~ ( ) { } [ ]` are key
  commands). Fixed: `escapeSendKeys`.
- High-risk tools can no longer hold a session/always grant; they ask every time.
- `analyze_screen` now honours `target`; active-window capture skips Pixel's own windows.
- Browser refuses localhost, LAN, link-local and cloud-metadata hosts by default.
- The mode is now taken from main-process settings, not from the renderer request.
- `.gitignore` `data/` -> `/data/`. It had been excluding `src/main/data/`
  (`database.ts`, `migrations.ts`), so a fresh clone could not compile.

Known gaps left open: tool timeouts do not cancel the underlying work; approvals
are not scoped to a domain/app; DNS-rebinding is not covered by the host check;
the browser tests that need Chromium could not run in the build sandbox.

## Round 2: preflight rejection and silent startup


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

## Repository and push identity

Requirement: commits and pushes belong to the GitHub account
**cypriankiprop41@gmail.com**.

Configured (repo-local, so it always wins over any global setting):

```
user.name  = Cyprian Kiprop
user.email = cypriankiprop41@gmail.com
```

Commits are made with that identity - do not override it with `-c user.name=...`.

**Push authentication is separate from commit identity.** Git Credential Manager
holds the credentials, and only one account is currently stored for github.com:

```
$ git-credential-manager github list
cypskip-create
```

So every push up to `0193964` authenticated as **cypskip-create**, even though the
commits were authored by the address above. To push as the requested account, that
account must be authenticated once, interactively:

```powershell
# 1. sign in as the account for cypriankiprop41@gmail.com
& "C:\Program Files\Git\mingw64\bin\git-credential-manager.exe" github login

# 2. confirm the stored account list
& "C:\Program Files\Git\mingw64\bin\git-credential-manager.exe" github list
```

If the stored list still shows only `cypskip-create`, remove the old entry first
(`... github logout`) and log in again. If the account has no write access to
`cypskip-create/Lore`, the remote must change as well:

```powershell
git remote set-url origin https://github.com/<account>/<repo>.git
```

Verify after the next push with `git-credential-manager github list`, or by
checking the commit author and pusher on GitHub.

## Installer/startup repair (branch `fix/installer-diagnostics`)

Investigated with REA (see `docs/debug/REA_INTEGRATION.md`), read-only.

### Verified root causes

1. **"cannot be closed" is a misleading shared message.** In electron-builder
   26.18.0 it is emitted from three unrelated paths (process kill, CopyFiles
   failure, old-uninstaller failure). It is not evidence that Pixel was running.
2. **The directory rejection was self-inflicted.** The 0.2.0 preflight lived in
   `.onVerifyInstDir`, which MUI calls while the path is being typed; the 0.2.1
   replacement ran in `customInit` before the page has a reliable `$INSTDIR`.
   Both rejected directories Windows can write to.
3. **Portable no-window was caused by the `RunAsNode` fuse being enabled.**
   REA `inspect_electron_fuses` on the 0.2.1 binary (`ev_1d1ce82f…`) shows
   `RunAsNode: enabled`; with a global `ELECTRON_RUN_AS_NODE=1` the exe becomes a
   plain Node interpreter: no Chromium, no window, no startup log.

### Repairs

- Removed both custom NSIS behaviours: `customCheckAppRunning` and the
  `customInit` directory preflight. Maintained electron-builder behaviour restored;
  `build/installer.nsh` now only cleans up legacy Cyps shortcuts/executable.
- Added `electronFuses` disabling `runAsNode`,
  `enableNodeOptionsEnvironmentVariable` and `enableNodeCliImportArguments`
  (verified applied: build log runs `@electron/fuses`; the rebuilt exe no longer
  behaves as Node under `ELECTRON_RUN_AS_NODE=1`).
- Added `--diagnostic-window`: an ordinary opaque resizable window loading the same
  renderer, skipping tray/shortcuts/floating window, to separate renderer faults
  from overlay faults.
- Kept identity: `appId` and NSIS GUID unchanged, so this upgrades in place.

### Fixed during the work

- YAML indentation defect (`nsis:  oneClick: false`) that broke packaging.
- Test suites asserted the removed overrides; replaced with the restored-default
  contract (no process override, no directory preflight, no data deletion).

### Test results (this branch)

| Check | Result |
| --- | --- |
| `tsc` main + renderer | pass |
| `vitest` | **273 passed** (14 files) |
| Distributions rebuilt | installer, portable, unpacked ZIP (0.2.1) |
| Fuses applied | verified in build log + behaviour change |

### Not verified (requires the laptop)

Gates A–H that need a real desktop: unpacked app starting with a window,
`--diagnostic-window` visible, floating orb visible, clean install, launch,
reinstall, upgrade, uninstall, and data preservation. This environment cannot
start any Chromium GUI process (`app.whenReady()` access violation), and the
packaged exe produces no output here.

Laptop sequence: `scripts\diagnose-pixel.ps1`, then
`scripts\capture-startup.ps1` (GUI), then the installer; attach the report if it
fails. `docs/debug/PIXEL_STARTUP_DIAGNOSTICS.md` lists every gate and its status.

## Companion milestone comparison (2026-11-07)

- Added `docs/research/CLICKY_TO_PIXEL_ARCHITECTURE.md`, comparing public Clicky
  implementations with Pixel across overlays, cursor following, multi-monitor
  behavior, click-through, state, capture, UI detection, pointing, voice,
  transient visibility, and lifecycle. No Clicky code was copied.
- `npm run verify`: typecheck passed, **439 tests across 19 files** passed
  (including 22 Chromium-backed browser tests), production build passed, and
  icon generation passed. Chromium was already cached; no download was needed.
- These are code/test/build results only. Windows GUI, unpacked launch, portable
  executable, NSIS installation/upgrades and installer repair remain unverified.
- The branch was `feature/pixel-companion-experience` at initial inspection and
  read as `main` at final status check. No branch switch was issued here; preserve
  and inspect existing uncommitted file/memory/document work before committing.
- No companion or safety code was changed in this pass; recommendations in the
  comparison are not completed acceptance criteria.