# Cyps

A personal AI companion that lives at the top of your Windows screen. It is a
small orb that stays out of the way, expands into a compact input bar when you
need it, and talks to DeepSeek.

Cyps is **not** a dashboard, not a chat application, and not a sidebar. The
largest surface it ever draws is 480 logical pixels wide.

## Status

This is the Wave 1 foundation: a real Electron application with a working
DeepSeek client, a floating window, a tray, global shortcuts, encrypted
credential storage, an agent permission model, and tests.

**What is verified by automated checks** (run `npm run verify`):

- TypeScript compiles under `strict` for both the main and renderer programs.
- The renderer builds for production.
- The main bundle compiles to loadable CommonJS.
- 147 unit tests pass against real logic: the DeepSeek wire protocol, SSE
  parsing, the conversation engine, history trimming, the tool permission
  policy, diagnostics, and the process-boundary invariants.

**What has not been verified in the authoring environment:** the window actually
appearing, tray behaviour, global shortcuts, drag and edge snapping, and real
screen capture. The machine this was built on cannot start any Chromium GUI
process (see [docs/ELECTRON-CONSTRAINTS.md](docs/ELECTRON-CONSTRAINTS.md)), so
those paths are compiled, packaged and reviewed but not exercised. They must be
confirmed on a normal Windows desktop. No part of this README claims otherwise.

## Requirements

- Windows 10 or 11
- Node.js 20 or newer (developed on 24.16.0)
- A DeepSeek API key from https://platform.deepseek.com

## Install and run

```powershell
npm install --ignore-scripts   # see note below
node node_modules\electron\install.js   # fetch the Electron binary
npm run build
npm start
```

`npm install --ignore-scripts` is required in restricted environments where
npm's script runner cannot spawn child processes. On a normal machine a plain
`npm install` works and the second step is unnecessary.

### Development

```powershell
npm run dev     # Vite dev server + Electron with hot reload of the renderer
```

### Package a Windows installer

```powershell
npm run dist    # produces release/Cyps-Setup-0.1.0.exe
```

The installer is per-user and does not require administrator rights. No code
signing certificate is configured, so Windows SmartScreen may warn on first run.
Signing is the distributor's responsibility and has not been faked.

## Adding your API key

Cyps never asks for the key in a chat and never writes it in plaintext.

1. Open the tray menu and choose **Settings...**, or press `Ctrl+,`.
2. Paste the key into **DeepSeek API key** and save.
3. The key is encrypted with Windows DPAPI through Electron's `safeStorage`.

If Windows reports that credential encryption is unavailable, Cyps **refuses to
store the key** rather than falling back to plaintext.

## Controls

| Action | Shortcut |
| --- | --- |
| Summon or hide Cyps | `Ctrl+Shift+C` |
| Emergency stop | `Ctrl+Shift+Escape` |
| Open settings | `Ctrl+,` |
| Collapse to the orb | `Esc` |

Drag the orb anywhere. The position is remembered and clamped to a visible
display, so unplugging a monitor cannot strand it off-screen.

## Modes

Cyps has three modes. Switching **up** in capability always asks first, and the
confirmation states what becomes possible.

| Mode | What it may do |
| --- | --- |
| **Guide** | Explains, teaches, annotates. Never changes anything on the machine. |
| **Hybrid** (default) | Guides and may act, but asks before anything sensitive. |
| **Agent** | Acts on approved apps. Sensitive steps are still confirmed. |

Permissions are enforced in the main process, not in the UI. Guide mode cannot
execute a state-changing tool even if the model asks for one.

### Emergency stop

`Ctrl+Shift+Escape` or the tray item. It:

- refuses any further tool call,
- cancels queued tasks,
- revokes every temporary authorization,
- aborts an in-flight model stream,
- records what had already completed.

It does **not** claim to undo an action that already ran. The report lists
completed actions explicitly so nothing implies a rollback that did not happen.

## Security

- The renderer has no Node access: `contextIsolation` on, `nodeIntegration` off,
  `sandbox` on. Native capability is reachable only through the narrow
  `window.cyps` preload bridge.
- No screen capture without an explicit user action. There is no timer and no
  background capture path.
- No invisible microphone recording. Voice is not enabled in this build, and the
  UI says so instead of pretending to listen.
- Model output cannot grant permission. Tool authority is a local policy table.
- Instructions found on websites, in documents, or in screenshots are treated as
  untrusted data, and the system prompt says so.
- The API key is never logged, never returned to the renderer, and never included
  in an error message.
- External links open in the system browser, never inside the app.

## Architecture

```
src/
  shared/        the contract: types, IPC channel names, surface geometry
  main/          Electron main process
    providers/   DeepSeek client (wire format, SSE, errors) + runtime facade
    agent/       conversation engine, tool permission policy, runtime services
    history/     conversation persistence
    system/      diagnostics
  preload/       the single native bridge (window.cyps)
  renderer/      React 19 floating UI
```

The renderer imports only `@shared/types` and talks to the shell through
`window.cyps`. It imports no Electron API; an architectural test enforces this.
That is what keeps a later migration to Tauri a shell-only change.

## Tests

```powershell
npm test          # 147 unit tests
npm run verify    # typecheck + tests + both builds
```

Tests cover behaviour rather than markup: real SSE chunk parsing, error mapping
for each HTTP status, history trimming under budget, the exact rules for when a
tool may run, and the invariants that keep the processes separated.

## Known gaps

- Voice input and text-to-speech are stubs that report themselves as
  unavailable. They are not implemented.
- The agent loop executes no tools yet; the registry, policy and approval flow
  exist and are tested, and are the insertion point for Wave 1D.
- Cyps Code is out of scope. Only the integration seam is reserved.
- Disk and battery readings are unavailable where WMI is blocked; the UI says
  "unavailable" rather than showing a fabricated number.

## License

MIT
