# Renaming Cyps to Pixel safely

The product is now **Pixel - Personal AI Desktop Companion**. The reserved name
for the future coding agent is **Pixel Code**; that workspace is out of scope.

Renaming a desktop application is not only a matter of strings. Three things are
load-bearing and were deliberately kept stable.

## 1. Installation identity - unchanged

| Setting | Value | Why |
| --- | --- | --- |
| `appId` | `com.cyps.companion` | Invisible. It keys the uninstall identity. |
| `nsis.guid` | `a5745318-c98a-51f9-87f5-f1c32713b276` | Pinned; derived from the appId above. |

electron-builder derives the uninstall GUID as
`UUID.v5(appId, ELECTRON_BUILDER_NS_UUID)` (`NsisTarget.js:261`). Because both
values are unchanged, **Pixel upgrades over Cyps in place**. There is no second
entry in "Installed apps" and no side-by-side copy.

Changing either value would have produced exactly the duplicate installation
this milestone was meant to avoid, so `tests/packaging.test.ts` asserts that the
pinned GUID still equals the derivation.

## 2. User data - migrated, with the original kept

Electron derives its data directory from the application name, so a rename would
have silently relocated every setting, conversation, encrypted API key and task
record. Pixel therefore sets the path explicitly and migrates on first launch:

| | |
| --- | --- |
| Previous location | `%APPDATA%\cyps` (the name the 0.1.0 build shipped with) |
| Also checked | `%APPDATA%\Cyps` |
| New location | `%APPDATA%\Pixel` |

Rules implemented in `src/main/startup/user-data.ts`, and covered by tests:

- copies `settings.json`, `credentials/`, `history/`, `executions/` only;
- never overwrites an existing Pixel file;
- never modifies or deletes the legacy directory - it stays as a manual backup;
- a copy failure becomes a warning in the startup log, never a failed launch;
- if the legacy folder exists but is incomplete, startup continues and says so.

Recovery path: the legacy folder is untouched, so copying it back over
`%APPDATA%\Pixel` restores the previous state exactly.

## 3. Internal contracts - unchanged on purpose

These names are part of the frozen cross-process contract or of persisted data,
and renaming them would risk regressions without any user-visible benefit:

- `CypsBridge`, `CypsError`, `CypsErrorCode` (TypeScript interfaces);
- `window.cyps` and `window.cypsShell` (preload surface);
- IPC channel strings such as `cyps:modeChanged`;
- `CYPS_DEV`, `CYPS_DEV_SERVER_URL` environment variables;
- CSS custom properties such as `--cyps-duration`.

A rebranding script (`scripts/rebrand.mjs`) was used to change the product name
in user-facing strings only, with an explicit guard that never rewrites those
identifiers. It updated 106 references across 33 files.

## 4. What is user-visible now

| Surface | Value |
| --- | --- |
| Window / app title | Pixel |
| Executable | `Pixel.exe` |
| Start menu shortcut | Pixel |
| Tray tooltip and menu | Pixel |
| Settings window title | Pixel Settings |
| Installer | `Pixel-Setup-0.2.0.exe` |
| Portable | `Pixel-Portable-0.2.0.exe` |
| Unpacked ZIP | `Pixel-Windows-Unpacked-0.2.0.zip` |
| Uninstall display name | Pixel |
| Spoken/written assistant identity | Pixel |
| Data directory | `%APPDATA%\Pixel` |

Legacy `Cyps` strings that remain are intentional: the migration code that looks
for old data, the installer's cleanup of old shortcuts and the old executable,
and the historical notes in this documentation.

## 5. Version

`0.1.0` was the Cyps build. Pixel ships as **`0.2.0`**: the installer was
repaired and the product renamed, with no user-facing capability removed. Waves
1A-1D (floating shell, DeepSeek streaming, agent tool loop, browser automation,
voice) are all preserved.
