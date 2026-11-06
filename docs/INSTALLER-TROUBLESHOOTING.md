# Installer troubleshooting: "Pixel cannot be closed"

## The symptom

Installing `Cyps-Setup-0.1.0.exe` on a real Windows laptop stopped with:

> Cyps cannot be closed. Please close it manually and click Retry to continue.

Observed at the same time:

- Task Manager showed no `Cyps.exe`;
- `taskkill /F /IM Cyps.exe` reported the process could not be found;
- Retrying made no difference.

That combination - *an application-close prompt with no application running* - is
the key clue, and it is why the message must not be taken at face value.

## What was verified in the source

electron-builder 26.18.0 has **three** separate code paths that show that exact
string. Only one of them is about a running application.

| # | Location | Real cause |
| --- | --- | --- |
| 1 | `include/allowOnlyOneInstallerInstance.nsh:156` | A process could not be terminated. |
| 2 | `include/extractAppPackage.nsh:116` | `CopyFiles` into `$INSTDIR` failed five times: **file lock, permissions, or disk**, nothing to do with a running app. |
| 3 | `include/installUtil.nsh:219` | The **previous version's uninstaller** failed five times during an upgrade. |

The dialog text `$(appCannotBeClosed)` is reused by all three. So the message
means "the installer could not replace the application files", not necessarily
"an application is running".

### Path 1 is misleading in this build

With PowerShell available (normal on Windows 10/11), the built-in check does not
use the executable name at all. `FIND_PROCESS` runs:

```powershell
Get-CimInstance Win32_Process |
  ? { $_.Path -and $_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase') }
```

Consequences:

- It matches **any** process whose executable lives under the install directory.
- `Win32_Process.Path` is **empty for processes the caller cannot inspect**
  (elevated or other-session). So an elevated Pixel instance is invisible to the
  check, while a leftover child process from the install directory is not.
- When it does find something it calls `Stop-Process`, and if that fails the loop
  ends in the "cannot be closed" dialog - with `taskkill` from a non-elevated
  shell reporting "not found", exactly as observed.

### Path 3 explains an endlessly failing Retry

If an earlier attempt left a **partial installation** - files present, uninstall
entry registered, but the uninstaller itself missing or blocked - every
subsequent attempt runs `uninstallOldVersion`, which copies and executes the old
uninstaller. That fails, retries five times, and shows the same dialog again. No
process is involved, and retrying can never succeed. This state is exactly what
`scripts/diagnose-installer.ps1` now looks for.

## What was confirmed vs what remains a hypothesis

**Confirmed by inspection of the pinned dependency** (electron-builder 26.18.0):

- the three code paths above, by file and line;
- the GUID derivation `UUID.v5(appId, ELECTRON_BUILDER_NS_UUID)` in
  `NsisTarget.js:261`;
- that this version already contains the exact-name `findstr /B` fix, so the
  upstream substring-match bug ([#6865](https://github.com/electron-userland/electron-builder/issues/6865),
  fixed by [PR #9784](https://github.com/electron-userland/electron-builder/pull/9784))
  is **not** the cause here;
- that [PR #6547](https://github.com/electron-userland/electron-builder/pull/6547)
  is what introduced the extract-then-copy stage whose failure raises path 2.

**Confirmed by building** - that our custom NSIS script is actually compiled: an
intentional error in `build/installer.nsh` aborted the build with
`!include: error in script: ".../build/installer.nsh" on line 101`.

**Not confirmed** - which of paths 2 or 3 produced the failure on the laptop.
This environment cannot run the GUI installer (it cannot start any Chromium
process, and the installer was observed to hang under the sandbox), so the
laptop state could not be inspected. `scripts/diagnose-installer.ps1` exists to
close that gap: it reports the partial-install condition, the registry
uninstaller path, running processes and the event log, read-only.

Given the evidence, the two most likely causes are, in order:

1. **A partial Cyps installation** whose uninstaller is missing or unusable
   (path 3). It reproduces the exact symptom: no process, retry always fails.
2. **A file-locked or unwritable target directory** (path 2), for example an
   antivirus scan on the freshly written 238 MB executable, or a directory the
   installer was allowed to write to only partially.

Upstream reports of the same family of behaviour:
[#9593](https://github.com/electron-userland/electron-builder/issues/9593)
("cannot be closed" with no orphaned processes, during updates),
[#6865](https://github.com/electron-userland/electron-builder/issues/6865)
(name collision false positive), and the per-machine-over-per-user detection fix
noted in the electron-builder changesets.

## What was changed

Non-destructive, and specific to the two causes we control.

### 1. Precise process detection (`build/installer.nsh`)

electron-builder honours a `customCheckAppRunning` macro if the installer
script defines one (`allowOnlyOneInstallerInstance.nsh:37`). Pixel defines it:

- matches only `Pixel.exe` and the legacy `Cyps.exe`, using
  `tasklist ... | findstr /B /I /C:"\"name\""` so a differently named process can
  never match;
- scopes termination to the current user (`/FI "USERNAME eq %USERNAME%"`) and
  never touches another product's processes;
- waits, retries a bounded number of times, then shows a message that says what
  is actually happening - "started as administrator, or in another session" -
  and points at Task Manager's Details tab;
- cancels cleanly, stating that nothing has been changed.

Detection is not disabled. It is made exact and honest.

### 2. Directory preflight (`build/installer.nsh`, `.onVerifyInstDir`)

The assisted installer lets you pick a directory. It previously accepted a
protected path (for example under `Program Files`) and only failed much later,
after five copy retries, with the unrelated "cannot be closed" text. Pixel now
tests writability the moment a path is entered, explains that Windows blocked it,
and returns you to the directory page instead of failing during extraction.

### 3. Stable installation identity (no code in the installer)

`appId` stays `com.cyps.companion`, and the derived NSIS GUID is now pinned:

```
guid = UUID.v5('com.cyps.companion', ELECTRON_BUILDER_NS_UUID)
     = a5745318-c98a-51f9-87f5-f1c32713b276
```

This is what makes Pixel **upgrade over** an existing Cyps rather than creating
a second, conflicting installation. A test asserts the pinned value still equals
the value the derivation produces, so a future edit cannot silently orphan the
old uninstall entry.

> An earlier draft of the config pinned `a50a2595-…` - a value produced by
> hashing the namespace *string* instead of the parsed UUID. The regression test
> caught it before it shipped; that would have created exactly the duplicate
> installation this work is meant to prevent.

### 4. Safe handling of the old installation

- The upgrade removes only the stale `Cyps.exe` and the old `Cyps.lnk`
  shortcuts, and only when the new `Pixel.exe` is already in place.
- Uninstall removes the same two leftovers.
- No script deletes `%APPDATA%` data, and `deleteAppDataOnUninstall` stays
  `false`.

## If it still fails on your machine

Run, **without needing a reboot**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\diagnose-installer.ps1 -Report "$env:USERPROFILE\Desktop\pixel-report.txt"
```

It is strictly read-only. The report answers, in order:

1. Is a Pixel or Cyps process (or an installer helper) still running?
2. Does an installation directory exist, and is it complete?
3. Is there an uninstall entry, and does the uninstaller it points to exist?
4. Do shortcuts point at files that are gone?
5. What does `%APPDATA%\Pixel\pixel-startup.log` say?
6. Are there crash entries in the Application event log?

Then choose one of these, in order of least risk:

| Situation | Action |
| --- | --- |
| Any Pixel/Cyps process is listed | End it in Task Manager ▸ Details (it may be a tray icon, not a window). |
| "Partial installation" is reported | Remove the entry from Settings ▸ Apps ▸ Installed apps, then install Pixel. Your data in `%APPDATA%` is untouched. |
| You just want to use the app now | Use `Pixel-Windows-Unpacked-0.2.0.zip` or `Pixel-Portable-0.2.0.exe` - neither uses NSIS. |
| Antivirus is suspected | Add the installation folder as an exclusion, then retry. |

## Reproducing the investigation

```powershell
# Which code paths can print the message?
Select-String -Path node_modules\app-builder-lib\templates\nsis\include\*.nsh -Pattern 'appCannotBeClosed'

# How is the install GUID derived?
Select-String -Path node_modules\app-builder-lib\out\targets\nsis\NsisTarget.js -Pattern 'UUID.v5'

# Prove our installer script is compiled:
#   add "!error PIXEL_PROBE" to build/installer.nsh, rebuild, and read the error.
```

## Follow-up: the directory preflight was itself broken (0.2.1)

On real hardware the 0.2.0 installer rejected a directory that Windows could
demonstrably write to (`%LOCALAPPDATA%\Programs\Pixel`), and changing the location
made no difference.

**Cause.** The check lived in `.onVerifyInstDir`. That callback belongs to MUI's
directory page and NSIS invokes it **while the path is still being edited**, not
once when the page is left. The shipped code then:

- showed a modal `MessageBox` from inside that callback, so a transient or
  partially typed path produced an error dialog mid-typing;
- called `Abort`, which cancels the directory change - and the page may not call
  the callback again for the same final value, leaving a valid directory in a
  rejected state;
- used `$0` without saving it, and `$0` is a general-purpose register the MUI page
  code relies on around that callback.

**Fix.** `.onVerifyInstDir` is gone. Validation now runs exactly once, in
`customInit`, after `$INSTDIR` has been initialised, using
`build/dir-check.nsh: PIXEL_CHECK_DIR_WRITABLE`. That macro treats the
**file-creation attempt as the only authority**, ignores the `CreateDirectory`
result (treating "already exists" as an error is what broke the old check), and
normalises a trailing separator. Registers are pushed and popped around it. If a
directory really is unwritable the user gets one accurate message offering Retry
or Cancel; a writable directory never prompts at all.

**Regression test.** `tests/nsis.test.ts` compiles the real NSIS macro with the
same `makensis` electron-builder uses, executes it, and reads the verdict. It
asserts:

| Case | Expected |
| --- | --- |
| existing writable directory | accepted |
| directory that does not exist yet but can be created | accepted, and created |
| path with a trailing separator (what Browse produces) | accepted |
| path on a nonexistent drive | rejected - the check still has teeth |
| probe file cleanup | no `.pixel-write-test` left behind |
| old vs new implementation | agree on bad paths, both accept good ones |

The suite is skipped with an explicit message if `makensis` is unavailable, so it
can never pass silently. Observed output: 11 tests, all passing.

This also documents *why the macro was not the original culprit*: the old logic
passes the same writable-directory cases in the harness. The rejection came from
where and when the callback ran, not from the write test itself.