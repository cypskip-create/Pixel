# Validating Pixel on Windows

Pixel was developed on a machine that cannot start any Chromium GUI process, so
the desktop-facing behaviour is compiled and packaged but **not** exercised
there. This document is the procedure to prove each of those behaviours on a
real laptop, and to diagnose it if something is wrong.

Run every command from the repository root.

## Latest automated verification (2026-11-07)

`npm run verify` passed on the current working tree: TypeScript type checks,
439 Vitest tests across 19 files (including 22 Chromium-backed browser tests),
production main/renderer build, and icon generation. Playwright Chromium was
already present in the repository's `.pw-browsers` cache, so no download was
needed. This does **not** verify Electron's Windows GUI, unpacked launch,
portable executable, NSIS install/upgrade, mixed-DPI overlays, or data
preservation. Those still require the real-laptop steps below; do not infer an
installer fix from this automated run.

## 0. One-time setup

```powershell
npm install --ignore-scripts
node node_modules\electron\install.js
npx playwright install chromium      # only needed for browser tools
npm run build
npm run dist
```

You should end up with:

- `release\win-unpacked\Pixel.exe`
- `release\Pixel-Setup-0.2.1.exe`

If `ELECTRON_RUN_AS_NODE` is set in your environment, Electron runs as plain
Node and **no window can appear**. Unset it first:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

## 1. Automated checks

```powershell
node scripts\diagnose.mjs                       # environment, build, voice, network
powershell -ExecutionPolicy Bypass -File scripts\validate-windows.ps1 -Launch
```

`validate-windows.ps1` starts Pixel, finds its window through `user32`, and checks
the properties that define "a floating companion": compact size, top-of-screen
position, always-on-top, transparent layered window, hidden from the taskbar,
sane DPI, and that the API key on disk is encrypted. It writes a
`validation-report-*.json` you can attach to a bug report.

A `[FAIL]` means a real defect. A `[SKIP]` means the check needed something that
was not running; re-run with `-Launch`.

## 2. Manual checklist

Each item lists what to do and what proves it worked. Anything that does not
match is a bug — not a preference.

### 2.1 Floating avatar visibility

1. Start Pixel from the Start menu (or the tray).
2. Look at the top of the screen.

**Pass:** a small round orb (~96 px) is visible near the top centre, with a soft
ring. Nothing else appears: no window frame, no title bar, no sidebar, no chat
panel, no dashboard.

**Fail:** an empty transparent rectangle, a full application window, or nothing
at all (check the tray icon exists before assuming it crashed).

### 2.2 Top-of-screen positioning

**Pass:** the orb sits roughly 16 px below the top edge of the work area, not
under the taskbar, on the monitor you were using when you last moved it.

### 2.3 Expand and collapse animations

1. Click the orb.
2. Click away, or press `Esc`.

**Pass:** the orb expands into a compact input bar about 480 px wide, centred
under where the orb was, with the top edge staying put. `Esc` collapses back to
the orb. With **Reduce motion** enabled in Settings the transition is instant
rather than animated.

**Fail:** the content is clipped, the window jumps to a corner, or the input bar
spans the screen.

### 2.4 Dragging and display scaling

1. Drag the orb around, including toward a screen edge.
2. Quit Pixel from the tray, then start it again.
3. If you have two monitors, drag Pixel to the second one, quit, restart, then
   unplug that monitor and restart again.

**Pass:** the orb follows the pointer smoothly; after restart it reappears where
you left it; it never ends up off-screen or half under the taskbar. On a scaled
display (125% or 150%) the orb stays crisp and the input bar does not overlap
itself.

**Fail:** the position resets to the centre each launch, the window drifts away
from the pointer, or text is cut off at 150% scaling.

### 2.5 DeepSeek connection

1. Open Settings (`Ctrl+,`), paste your DeepSeek API key, save.
2. Press **Test connection**.
3. Ask something short in the input bar.

**Pass:** the test reports success with a latency, and the answer streams into a
bubble above the bar. Reasoning, if the model emits it, appears in its own
collapsible section rather than being mixed into the answer.

**Fail:** "No API key" when one is clearly saved, or a rejection message. Pixel
reports the exact DeepSeek error (`UNAUTHORIZED` for a bad key, `INSUFFICIENT_BALANCE`
for an empty account, `RATE_LIMITED` with a retry hint) rather than a generic
failure.

### 2.6 Screenshot inspection

1. Open a page with text on it, for example a news site.
2. Click the camera button in Pixel' bar.
3. Ask "what does this say?" or "summarise what you can see".

**Pass:** a thumbnail of the captured screen appears as an attachment, and the
answer describes content that was actually on screen — including text you can
read yourself. DPI is correct: the capture is not blurry or offset by the scale
factor.

**Fail:** a black image (capture blocked), or an answer that invents content.
Pixel refuses locally if the selected model cannot accept images, instead of
sending an invalid request.

**Guide mode note:** screen analysis requires an approval prompt. In **Guide**
mode Pixel will not run `analyze_screen` at all — that is intended.

### 2.7 Tray and global shortcuts

1. Right-click the tray icon.
2. Try the menu items: show/hide, mode, Settings, Emergency stop, Quit.
3. Press `Ctrl+Shift+C` from another application.
4. Press `Ctrl+Shift+Escape` while Pixel is answering.

**Pass:** the tray menu appears with a mode submenu (the active mode ticked);
`Ctrl+Shift+C` toggles Pixel from any application; `Ctrl+Shift+Escape` stops
Pixel immediately and shows the emergency-stop banner. Shortcuts keep working
after a Pixel restart.

**Fail:** the menu is missing, a shortcut does nothing. If another application
already owns `Ctrl+Shift+C` Windows gives it to that app; change the shortcut in
Settings.

### 2.8 Permissions and emergency stop

1. Switch from **Guide** to **Hybrid** or **Agent**.
2. Ask Pixel to open Notepad, e.g. "open notepad".

**Pass:** the mode change shows a confirmation that explains what becomes
possible. Then a permission card appears naming the action, the target and the
risk, with Deny / Allow once / Allow for session buttons **before** anything
happens. Denying leaves Notepad closed, and Pixel says it could not act rather
than pretending it did.

3. Trigger an action and press `Ctrl+Shift+Escape` while the permission card is
   still waiting.

**Pass:** the card disappears, the action is refused, and the banner reports what
was cancelled. After a stop, pressing the orb again says Pixel is stopped instead
of quietly continuing.

**Fail:** anything happens on the machine before the card is approved.

## 3. Browser automation

1. Switch to Hybrid or Agent.
2. Say: "open example.com and tell me the heading".

**Pass:** an approval card appears for navigating; after approving, the answer
quotes the real page heading. Ask it to "click the link" and it shows a
screenshot of the result.

If Playwright's browser is missing, Pixel returns a capability error naming the
exact command to run — it does not pretend to browse.

## 4. Voice

1. Open Settings and enable speech replies.
2. Click the ear button in the bar and say "what time is it".

**Pass:** the orb switches to the listening state, your words appear in the
input field after you finish, and (with speech replies on) the answer is spoken.

**Pass with no microphone:** Pixel says it did not hear anything.

**Fail:** Pixel shows invented text. It must never fabricate a transcript; if no
recognizer is installed it says so explicitly.

Check what your machine has:

```powershell
node scripts\diagnose.mjs    # look at the Voice section
```

## 5. What to report

If a check fails, attach:

- the `validation-report-*.json` produced by `validate-windows.ps1`;
- the output of `node scripts\diagnose.mjs --json`;
- your display scaling and the number of monitors;
- what you expected versus what happened.

Logs are in `%APPDATA%\Pixel\`. Delete `credentials\deepseek.key` before sharing
anything from that folder.

## 6. Known limitations

- No code signing certificate: SmartScreen may warn on first run.
- Browser tools need `npx playwright install chromium` once per machine.
- Elevated (admin) applications cannot be typed into by Pixel; Windows blocks
  input injection across integrity levels.
- Disk and battery readings are unavailable where WMI is blocked; the UI says
  "unavailable" rather than a fabricated number.

---

## 7. Companion-milestone validation (added in Round 4)

Everything in this section is **unverified on Windows** until you run it. The logic behind it
is unit-tested; the OS behaviour is not. Report each item as pass / fail / blocked.

### 7.1 Order of operations

Do these in order. Do not test the installer until the unpacked app launches.

```powershell
npm run build
```

```powershell
npm run dist
```

```powershell
.\release\win-unpacked\Pixel.exe --diagnostic-window
```

Then launch `.\release\win-unpacked\Pixel.exe` normally and confirm the orb appears. Only then
try the portable build and `Pixel-Setup-*.exe`.

### 7.2 Installation state (read-only first)

```powershell
npm run repair:install
```

Read the report. Only if it shows a stale registration or a lock, and you are happy with the
plan it prints, run the modifying mode (it asks you to type YES and backs up the registry keys):

```powershell
npm run repair:install -- -Apply
```

### 7.3 Native UI Automation helper (`PixelNative.exe`)

```powershell
.\scripts\build-native.ps1
```

Smoke test. Each should print one JSON line with `"ok":true`:

```powershell
'{"id":1,"cmd":"ping","args":{}}' | .\native\bin\PixelNative.exe
```

Click into Notepad within 5 seconds of running this, then read the result:

```powershell
Start-Sleep 5; '{"id":2,"cmd":"foreground_window","args":{}}' | .\native\bin\PixelNative.exe
```

```powershell
Start-Sleep 5; '{"id":3,"cmd":"find_elements","args":{"text":"File","maxResults":5}}' | .\native\bin\PixelNative.exe
```

Pass criteria: `foreground_window` names Notepad; `find_elements` returns the **File** menu with a
non-empty `rect`; the rect, converted to DIP, sits on the real menu. If your display scale is
not 100 %, check specifically that the rectangle is **not** offset or scaled wrongly. That is
the whole point of the DPI-awareness call. This file has **not been compiled yet**: if
`build-native.ps1` fails, send me the compiler error text.

### 7.4 Checks the cursor companion will need once its window exists

| # | Check | Pass when |
|---|---|---|
| 1 | Passive overlay is click-through | You can click and type in the app underneath |
| 2 | Overlay never takes focus | The window you were typing in stays active |
| 3 | Mixed-DPI move | Companion glides across monitors with no jump or resize |
| 4 | Monitor unplugged | Orb reappears on a remaining monitor (see `ensureVisible`) |
| 5 | Full-screen video / game | Overlay does not break playback or exclusive full screen |
| 6 | Idle CPU | Task Manager shows ~0 % for Pixel when the mouse is still |
| 7 | Capture excludes Pixel | The screenshot Pixel sends does not contain its own orb or bubble |

### 7.5 What is **not** implemented yet (so do not test it)

- The cursor-companion window and React overlay (engine and settings exist; the window does not).
- Pointing animation on screen (targets, flight paths and tracking exist as logic only).
- Push-to-talk key *release* (needs a native keyboard hook; toggle-to-talk is the fallback).
- Transcription provider abstraction, audio-level waveform, device selection.
- SQLite audit store (a JSONL file at `%APPDATA%\Pixel\audit\audit.jsonl` is used instead).