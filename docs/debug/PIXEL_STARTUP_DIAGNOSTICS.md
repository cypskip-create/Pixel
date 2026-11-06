# Pixel startup diagnostics

## Why this exists

The reported failure was "no window and no log file". That combination is
diagnostically hostile: it can mean the process never started, died before our
code, or wrote its log somewhere unexpected. Each of those has a different fix, so
the app now records enough to tell them apart, and ships a mode that does not need
a window at all.

## What the app records

| Mechanism | Where | What it proves |
| --- | --- | --- |
| Boot log (`src/main/startup/boot.ts`) | `%APPDATA%\Pixel\pixel-startup.log` | Java, no — proves the process reached JavaScript, and the last stage it reached |
| Log fallback chain | `%APPDATA%\cyps` → `%TEMP%\Pixel` → `%USERPROFILE%\Pixel-logs` → cwd | a log exists even when the profile is not writable; the chosen path is the first line |
| stderr mirror | console, when launched from a terminal | visible without opening a file |
| Exit marker | `pixel-last-exit.json` beside the log | the exit code survives a GUI app that never attached to a console |
| Startup stages | log lines `boot`, `stage`, `info`, `warn`, `error`, `exit` | which step failed: module load, Electron ready, window create, renderer load |
| Renderer/preload failures | `did-fail-load`, `preload-error` | a missing or mispathed asset |
| Child/renderer crashes | `render-process-gone`, `child-process-gone` | a Chromium-level death after startup |
| Show fallback | window forced visible after 8 s if `ready-to-show` never fires | a renderer that never paints cannot leave an invisible process |
| Fuses (`electron-builder.yml`) | `RunAsNode` disabled | `ELECTRON_RUN_AS_NODE=1` can no longer turn the exe into a plain Node script |

## Modes

| Command | What it does | Use when |
| --- | --- | --- |
| `Pixel.exe` | floating assistant (normal product) | daily use |
| `Pixel.exe --diagnostic-window` | **ordinary opaque resizable window**, no tray, no shortcuts, no transparency, no always-on-top | the orb does not appear and you need to know whether the renderer works |
| `Pixel.exe --pixel-selfcheck` | no window; prints JSON and writes `pixel-selfcheck.json` next to the log | confirm bundle/preload/renderer paths and Electron initialisation |

`--diagnostic-window` deliberately avoids every window feature the floating orb
uses, so a failure there isolates the *renderer*, not the overlay.

## What the diagnostic window reports

- the renderer path it will load, logged before load;
- `did-fail-load` with Chromium's error code and URL;
- `preload-error` with the preload path;
- `Diagnostic window is visible.` once it paints.

If the window appears, the renderer and preload are fine and the problem is in the
floating window's geometry/transparency. If it does not, the log names the exact
file that failed.

## Scripts

Two read-only scripts, neither of which changes the machine:

```powershell
# startup behaviour: exit code, window presence/bounds/styles, logs, Chromium log
powershell -ExecutionPolicy Bypass -File scripts\capture-startup.ps1 -Exe "release\win-unpacked\Pixel.exe"

# installation/environment: processes, install dirs, uninstall entries, shortcuts,
# event log, partial-install detection
powershell -ExecutionPolicy Bypass -File scripts\diagnose-installer.ps1 -Report "$env:USERPROFILE\Desktop\pixel-report.txt"
```

`capture-startup.ps1` also launches the GUI with `--enable-logging
--log-file=%TEMP%\pixel-chromium.log`, which captures failures that happen *before*
any Pixel JavaScript runs — the case with no app log and no event-log entry.

## Validation status in this environment

| Gate | Result |
| --- | --- |
| A — unpacked build starts | **not verified**: packaged `Pixel.exe` produces no output here and cannot initialise Chromium (access violation, unchanged) |
| A (partial) — bundle completeness | **verified**: `--pixel-selfcheck` reports every required file present on the development bundle |
| B — diagnostic window displays | **not verified** (no GUI), code path added and typechecked |
| C — floating assistant appears | **not verified** (no GUI) |
| D — logs and crash reporting | **verified** for the boot logger and self-check on the development bundle; packaged run cannot reach it here |
| E–H — portable, installer, clean install/upgrade/uninstall, data preservation | **not verified**: requires the laptop |

Nothing above is claimed as tested on Windows GUI. The laptop command sequence is:
`capture-startup.ps1 -SelfCheck`, then `capture-startup.ps1` (GUI), then the
installer with `diagnose-installer.ps1` if it fails.
