# Pixel

A personal AI companion for Windows. Pixel keeps a compact top-center bar
available for conversation, with an optional independent cursor companion.
The bar expands downward for responses, approvals, settings and recent chats;
long content scrolls inside the available display work area.

## Status

Pixel has a bounded DeepSeek tool loop, a main-process permission gateway,
project-scoped SQLite memory, browser/file/document capabilities, a compact task
timeline, reviewed skills, local routines and multi-conversation chat history.
The Windows UI Automation helper can inspect accessible controls and invoke a
uniquely matched control after approval. The primary bar stays pinned to a
selected display; an optional cursor companion follows independently. Tasks
are stored durably; work interrupted by restart is restored as paused and is
never resumed automatically. State-changing actions that lack postcondition
evidence finish as **Needs verification**.

Recent Chats restores conversations saved while `privacy.persistHistory` is
enabled. Stored transcripts contain sanitized user-facing messages; disabling
history keeps new conversation data in the current session only. Explicit web
search requests open the selected Google, Bing or DuckDuckGo results page in
the system's default browser. Pixel reports that the page was opened and does
not claim to have read its results.

The sandboxed preload is bundled from `src/preload/index.ts` into one
`dist/main/preload/index.js` file. It inlines the shared IPC channel registry and
leaves only Electron external, preserving the narrow `window.cyps` and
`window.cypsShell` surfaces. Run `npm run test:preload-sandbox` to exercise those
surfaces inside an Electron sandboxed window; see the Windows acceptance guide
for live settings and packaged-app checks.

Use [`docs/research/PIXEL_CURRENT_STATE.md`](docs/research/PIXEL_CURRENT_STATE.md)
for the source-backed feature inventory. The latest command results, exact test
totals, release blockers and laptop-side commands are in
[`docs/validation/PIXEL_RELEASE_READINESS.md`](docs/validation/PIXEL_RELEASE_READINESS.md).
Type checking, unit tests and production builds do not prove the Windows window,
tray, microphone, installer or multi-monitor behavior. Follow
[`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md)
for the target-machine acceptance run.

The separate Pixel Workspace opens from the island toolbar, tray menu or its
configurable global shortcut. It shares the same main-process conversation,
tasks, project memory, tools, permissions, settings and emergency stop; it does
not start a second assistant engine. Its window size, maximized state and
position are saved locally. The approved P geometry and original color master
are defined once in `src/shared/pixelMark.json`; the renderer uses a monochrome
variation while tray and Windows app assets retain the master artwork.

Workspace opens directly into the conversation. Recent chats stay in the
sidebar, secondary areas live under Library, and execution details appear only
when requested. Approval cards remain visible with the conversation; the mode
selector and message composer stay compact until needed.

Pixel uses a shared black-and-charcoal monochrome design system across the
Workspace and floating Island. Visible surfaces are opaque; Windows Acrylic,
Mica and CSS backdrop blur are not used. The approved P geometry is rendered in
grayscale within the app. `npm run dev:gpu` is available for separate GPU
diagnostics; regular `npm run dev` continues to pass `--disable-gpu`. See the
[design token reference](docs/architecture/PIXEL_DESIGN_TOKENS.md) and the
[current validation report](docs/validation/INTERACTION_ENGINE_3_READINESS.md)
for verified and unverified behavior.

Type checks, automated tests and production builds do not prove the restored UI
over real desktop content. The Windows visual comparison and packaged startup
remain acceptance steps. See the [current release-readiness
report](docs/validation/PIXEL_RELEASE_READINESS.md) before treating this tree
as a release candidate.

The current architecture and security boundaries are in
[`docs/architecture/PIXEL_AGENT_RUNTIME.md`](docs/architecture/PIXEL_AGENT_RUNTIME.md)
and [`docs/architecture/PIXEL_SECURITY_MODEL.md`](docs/architecture/PIXEL_SECURITY_MODEL.md).

## Requirements

- Windows 10 or 11
- Node.js 20 or newer (developed on 24.16.0)
- A DeepSeek API key from https://platform.deepseek.com

## Install and run

### The three Windows distributions

Every build produces three files in `release\`:

| File | Use it when |
| --- | --- |
| `Pixel-Setup-0.2.1.exe` | Normal installation. Per-user, no administrator prompt, Start menu entry, uninstallable. |
| `Pixel-Portable-0.2.1.exe` | You want to try Pixel without installing anything. Double-click and run. |
| `Pixel-Windows-Unpacked-0.2.1.zip` | You want to inspect or run the app with no NSIS involvement at all. Extract, then run `Pixel.exe`. |

**Install:** run `Pixel-Setup-0.2.1.exe`, follow the wizard, then launch Pixel
from the Start menu or the tray.

**Portable:** double-click `Pixel-Portable-0.2.1.exe`. It extracts to a temporary
folder and runs; nothing is registered with Windows.

**Unpacked:** extract the ZIP anywhere and run `Pixel.exe`. This is the
recommended first test because it bypasses the installer entirely.

Upgrading from the previous Cyps build works in place: the installer keeps the
same application identity, so it replaces Cyps rather than installing a second
copy. Your settings, conversations and encrypted API key are migrated from
`%APPDATA%\cyps` to `%APPDATA%\Pixel` on first launch, and the old folder is kept
as a backup. See [docs/REBRANDING.md](docs/REBRANDING.md).

If an installation fails, run the read-only diagnostics before changing anything:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\diagnose-installer.ps1
```

See [docs/INSTALLER-TROUBLESHOOTING.md](docs/INSTALLER-TROUBLESHOOTING.md).

### Building from source

```powershell
npm install --ignore-scripts   # see note below
node node_modules\electron\install.js   # fetch the Electron binary
npx playwright install chromium  # only needed for browser tools
npm run build
npm run build:native  # optional native UI Automation helper for development
npm start
```

`npm install --ignore-scripts` is required in restricted environments where
npm's script runner cannot spawn child processes. On a normal machine a plain
`npm install` works and the second step is unnecessary.

### Development

```powershell
npm run dev     # Vite dev server + Electron loading it for renderer hot reload
```

### Package the Windows distributions

```powershell
npm run dist    # installer + portable + unpacked ZIP, all under release/
```

The installer is per-user and does not require administrator rights. No code
signing certificate is configured, so Windows SmartScreen may warn on first run.
Signing is the distributor's responsibility and has not been faked.

## Adding your API key

Pixel never asks for the key in a chat and never writes it in plaintext.

1. Open the tray menu and choose **Settings...**, or press `Ctrl+,`.
2. Under **Privacy → API key**, choose **Add Key**, enter the key, then choose **Save Key**. Pixel shows only whether a key is configured; it never reads the stored value back into the interface.
3. Choose **Test Connection** to make one explicit provider check. Use **Change Key** to replace it or **Remove Key** to delete it after confirmation.
4. The key is encrypted with Windows DPAPI through Electron's `safeStorage`.

If Windows reports that credential encryption is unavailable, Pixel **refuses to
store the key** rather than falling back to plaintext.

## Controls

| Action | Shortcut |
| --- | --- |
| Summon or hide Pixel | `Ctrl+Shift+C` |
| Open Workspace | `Ctrl+Shift+P` (configurable in Settings) |
| Emergency stop | `Ctrl+Shift+Escape` |
| Open settings | `Ctrl+,` |
| Collapse to the orb | `Esc` |

The primary bar stays horizontally centered near the top of its selected
display. Open **Settings → Move to display** to choose the display; the top
offset is available alongside the pinned-bar controls.
The optional cursor companion is controlled independently and never moves the
primary bar.

## Conversations and browser search

Use the History control on the bar to search and restore recent conversations,
create a new conversation, rename one, or delete a conversation after
confirmation. Pixel keeps the active transcript and model context in the main
process; renderer-supplied transcript history is not trusted. When history
persistence is disabled, new messages remain session-only.

Say or type an explicit request such as “Search the web for electric cars.”
Pixel opens a search results page in the Windows default browser using the
provider selected in Settings. Ordinary questions do not trigger browser
search. Opening the page does not mean Pixel read or verified the results.

## Modes

Pixel has three modes. Switching **up** in capability always asks first, and the
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
- Voice input supports a configured global push-to-talk chord (default
  `Ctrl+Shift+Space`) and explicit manual dictation. Push-to-talk submits one
  valid local transcript; manual dictation leaves it in the draft. Recognition
  uses Windows System.Speech when installed, or optional local faster-whisper
  only when its selected model is already cached. Pixel never downloads a model
  or sends raw audio to a provider. Availability depends on the Windows account,
  microphone permission and installed local model; the full microphone path
  still requires laptop acceptance.
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
npm test          # Full Vitest suite; see the release-readiness report for current totals
npm run test:preload-sandbox  # Electron sandbox bridge and IPC integration smoke test
npm run verify    # typecheck + tests + both builds
```

Tests cover behaviour rather than markup: real SSE chunk parsing, error mapping
for each HTTP status, history trimming under budget, the exact rules for when a
tool may run, and the invariants that keep the processes separated.

## Continuous integration

`.github/workflows/windows-ci.yml` checks types, installs Playwright Chromium,
runs the full test suite and sandboxed preload smoke, compiles `PixelNative.exe`,
and builds the unpacked app, portable executable and NSIS installer on Windows.
It uploads logs, smoke/JUnit test results and build artifacts for 14 days. The
workflow builds artifacts only and does not publish releases.

## What Pixel can do

Pixel can answer questions, restore earlier conversations, open a browser
search, inspect the screen with approval, track foreground-window metadata,
open an allowlist of applications, type into a revalidated target, and drive a
web page in a controlled browser: navigate, read it, click, type, scroll,
screenshot, and verify supported actions.

Every action that changes something goes through a permission prompt first, and
Guide mode cannot run such actions at all.

## Validating on Windows

The desktop behaviour cannot be verified in a headless build machine. Run this on
the machine where you installed Pixel:

```powershell
node scripts\diagnose.mjs
powershell -ExecutionPolicy Bypass -File scripts\validate-windows.ps1 -Launch
```

The script inspects the real window (size, top-of-screen position, always-on-top,
transparency, taskbar visibility, DPI) and writes a JSON report.
[`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md`](docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md)
is the current ordered acceptance checklist.

## Known gaps

- Browser automation needs `npx playwright install chromium` once per machine;
  simple web search uses the default browser and does not require Playwright.
- Typing into elevated (administrator) windows is blocked by Windows integrity
  levels.
- `open_application` only launches an allowlist of applications by design.
- Browser automation and the full app UI require a normal desktop runtime;
  unit tests and production builds do not verify native window behavior.
- Skills are model-mediated and have no interaction recorder or deterministic
  live replay runner. Specialist roles are not backed by an independent model
  delegation loop.
- There is no general credential broker. Passwords, MFA, passkeys and payment
  confirmation remain human-controlled.
- Pixel Code is out of scope. Only the integration seam is reserved.
- Disk and battery readings are unavailable where WMI is blocked; the UI says
  "unavailable" rather than showing a fabricated number.

## License

MIT
