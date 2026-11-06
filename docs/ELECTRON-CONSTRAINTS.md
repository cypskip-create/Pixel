# Electron runtime constraints in this environment

Status: **verified by experiment** on 2026-11-06, Node v24.16.0, Electron 45.2.3,
Windows 10.0.26300.

This document records what Electron can and cannot do *in this sandbox*. It is
an environment limitation, **not a defect in Cyps**. On a normal Windows desktop
none of this applies.

## Blocker 1: `ELECTRON_RUN_AS_NODE=1` is set globally

The shell exports `ELECTRON_RUN_AS_NODE=1`, so `electron.exe` behaves as a plain
Node interpreter and rejects Electron CLI switches:

```
$ electron.exe --version                    # variable set
v45.2.3                                     # works, but as Node

$ electron.exe --no-sandbox --version       # variable set
electron.exe: bad option: --no-sandbox       # exit 9
```

**Workaround:** delete the variable before launching.

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

Note that with the variable set, `electron.exe <app-dir>` still *runs* the app's
main script as Node, which is enough to catch module-load errors. That is how
the two real Cyps bugs below were found.

## Blocker 2: Chromium's GUI cannot initialize

With the variable removed and `--no-sandbox --disable-gpu` passed, the process
dies as soon as Chromium starts:

| Probe | Result |
| --- | --- |
| `electron.exe --version` | exit 0 |
| Node-style entry: `console.log`, `process.exit` | exit 0 |
| `require('electron')`, read `typeof app` | exit 0 |
| `app.whenReady()` | crash, access violation (exit `-1073741819`, `0xC0000005`) |
| `screen.getAllDisplays()` after ready | crash |
| `new BrowserWindow(...)` | crash |
| Cyps' own packaged exe | exits immediately |

`--single-process`, `--in-process-gpu`, `--headless`, `--disable-breakpad` and
`--disable-crash-reporter` do not help.

Launching the real Cyps bundle gets one step further and then fails on
Chromium's crash handler:

```
ERROR:third_party\crashpad\crashpad\client\crashpad_client_win.cc:887] not connected
exit=-36861
```

"not connected" means the Chromium process could not reach its crashpad handler
process. That is consistent with the sandbox blocking the named pipes and child
process coordination Chromium requires.

**Consequence:** Cyps cannot be *launched* in this environment. It can be
type-checked, unit-tested, built and packaged.

## Real bugs this investigation found

Running the app under Electron-as-Node caught defects that no type check would
have:

1. **`ipc.ts` imported the preload module** to share IPC channel names. That
   executed `contextBridge.exposeInMainWorld` inside the main process, where
   `contextBridge` is `undefined`, and the app died during load. Fixed by moving
   channel names to `src/shared/channels.ts`; `tests/architecture.test.ts` now
   fails the build if any `src/main` module imports `preload` again.
2. **The compiled entry path was wrong.** With `rootDir: src`, output landed at
   `dist/main/main/main.js` while `package.json` pointed at `dist/main/main.js`.
   The preload and renderer paths were wrong for the same reason.

## What is verified here

- TypeScript compiles under `strict` (main and renderer).
- The Vite production renderer build succeeds.
- The main bundle compiles and every non-GUI module loads as CommonJS.
- 133 unit tests pass against real logic.
- `electron-builder --win --dir` produces `release/win-unpacked/Cyps.exe` with
  the correct asar contents.

## What must be verified on a real desktop

- The window appearing, floating, staying on top, and not stealing focus.
- Tray icon and its menu.
- Global shortcut registration (including conflicts).
- Drag, edge snap, and position persistence across restarts.
- Real `desktopCapturer` capture and DPI correctness.
- Installer run and uninstall.

Until those are done, Cyps must not be described as tested for them.

## Development workaround

```powershell
npm run typecheck
npm run test
npm run build
npm run dist
```
