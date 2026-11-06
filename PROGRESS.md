# Cyps progress

Updated: Waves 1A-1D complete, plus browser automation, voice, and the Windows
validation kit.

## Current milestone

**Wave 1D (agent execution) is complete**, along with browser automation
(Priority 2), voice (Priority 3) and the Windows validation procedure
(Priority 4). The remaining work is on-device verification, which cannot be done
in this environment, and Wave 1E polish.

## Completed

### Wave 1A - foundation
- TypeScript strict, Vite 8, React 19, Tailwind v4, Vitest.
- `src/shared/types.ts` as the cross-process contract (frozen).
- `src/shared/channels.ts` IPC names, `src/shared/surfaces.ts` geometry.
- DeepSeek provider: wire format, SSE, thinking mode, vision gating, error
  mapping, cost estimates, history trimming.
- Environment findings in `docs/ENVIRONMENT.md`, `docs/DEEPSEEK-API.md`,
  `docs/ELECTRON-CONSTRAINTS.md`.

### Wave 1B - floating UI
- Frameless transparent always-on-top window at `floating` level (below system
  dialogs), 96 px orb, 480 px expanded surfaces, position persistence with
  work-area clamping and display-change re-clamping.
- Tray with mode submenu and emergency stop; runtime-generated icon.
- Global shortcuts with conflict tolerance.
- React UI: 8-state orb, compact input bar, streaming bubble with separate
  reasoning view, mode switcher, permission card, task strip, settings window.
- Accessibility: labelled controls, focus rings, `aria-live`, reduced motion.

### Wave 1C - working AI
- DPAPI-encrypted key via `safeStorage`; refuses plaintext fallback.
- Conversation engine with hard safety rules, stop checks before and during a
  turn, vision-model auto-upgrade, typed error events.
- Streaming to the UI with requestId pairing and pre-resolve event buffering.
- History persistence with caps and corrupt-file recovery.
- Screen capture with per-action authorization and DPI-correct sizing.

### Wave 1D - agent execution (this milestone)
- **Real tool-calling loop**: model -> tool calls -> policy -> approval ->
  execution -> tool results -> model continuation, up to 8 steps.
- **Real executors**, no simulation: `get_current_time`, `get_system_info`,
  `open_application` (allowlist + `cmd start`), `type_text` (PowerShell
  `SendKeys` with the text passed via environment, not interpolated into the
  script), `analyze_screen` (capture + vision model).
- **Policy enforcement**: Guide mode cannot run a state-changing tool even if
  approved; single-use grants are consumed; denials are reported to the model.
- **Limits**: 8 steps, 5-minute wall clock, 30-second per tool, cancellation,
  emergency stop checked between and during steps.
- **Progress**: task records with real steps and timings; terminal `done`/
  `aborted`/`error` events carry the chat request id so the UI stops streaming
  at the right moment (a bug found and fixed: `done` fired per step).
- **Persistence**: last 50 runs written to `%APPDATA%\Cyps\executions\`, audit
  trail in memory (500 entries, newest first).
- **25 integration tests**: approval, denial, execution, unknown tool, tool
  failure with model recovery, step-limit, cancellation between steps,
  emergency stop mid-run, re-entrancy, persistence, argument parsing.

### Priority 2 - browser automation
- `BrowserSession` over Playwright: navigate, inspect (title/text/links/buttons/
  inputs), click, fill, press, scroll, screenshot, text verification.
- URL policy: only http/https (file:// only when explicitly enabled); refuses
  `javascript:` and `data:` URLs with an explanation.
- 7 browser tools registered, mode-gated (Guide gets only the read-only ones).
- **22 tests, including 14 against a live headless Chromium** driving a real
  page served from 127.0.0.1: clicking changes the DOM, typing submits a form,
  screenshots decode as PNG, scrolling moves the page, bad selectors return tool
  failures rather than throwing.

### Priority 3 - voice
- Windows `System.Speech` through PowerShell: local dictation and system voices.
- Real capability probe (`stt=true tts=true` on this machine: 2 recognizers,
  3 voices), cancellation, honest no-speech handling.
- Push-to-talk in the UI: listening state, transcript into the draft, precise
  errors when speech is unavailable; optional spoken replies.
- **18 tests** including a live capability probe against the real machine.

### Priority 4 - Windows validation
- `scripts/validate-windows.ps1` - launches Cyps and inspects the real window via
  `user32`: compact size, top-of-screen position, WS_EX_TOPMOST, WS_EX_LAYERED,
  WS_EX_TOOLWINDOW, DPI, process health, stored-data encryption. Writes a JSON
  report. Verified here (4 checks pass, window checks skip without a process).
- `scripts/diagnose.mjs` - environment, dependencies, build artifacts, Playwright
  browsers, speech recognizers and voices, credential encryption, DeepSeek
  reachability. Verified here: 19 pass, 1 fail (ELECTRON_RUN_AS_NODE is set in
  this sandbox, which is the correct diagnosis).
- `docs/WINDOWS-VALIDATION.md` - step-by-step manual procedure covering every
  item that cannot be verified headlessly.

## Verification status

| Check | Result |
| --- | --- |
| `tsc` main program | pass |
| `tsc` renderer program | pass |
| `vitest` | **212 tests pass** (10 files) |
| live headless Chromium tests | 14 pass |
| live speech capability probe | pass (2 recognizers, 3 voices) |
| `vite build` | pass |
| compiled main bundle loads as CJS | pass |
| `electron-builder --win` | pass (`Cyps-Setup-0.1.0.exe`) |
| `validate-windows.ps1` (dry run) | 4 pass, 1 warn, 4 skip |
| `diagnose.mjs` | 19 pass, 1 fail (correct: ELECTRON_RUN_AS_NODE set) |
| GUI window, tray, shortcuts, drag, capture | **not verifiable here** |

The machine used for development cannot start any Chromium GUI process
(`app.whenReady()` crashes, packaged app exits on crashpad "not connected").
Everything above marked "not verifiable" is compiled, packaged and reviewed, and
must be confirmed with `docs/WINDOWS-VALIDATION.md`. No document claims those
paths are tested.

## Architectural decisions

1. **Electron instead of Tauri.** Rust could not be installed. The renderer talks
   only to `window.cyps`, so a Tauri migration touches `src/main` + `src/preload`.
2. **CommonJS for main/preload**, marked by a generated `dist/main/package.json`.
3. **IPC names in `shared`.** Importing them from the preload into main executed
   `contextBridge` in main and killed startup; an architecture test guards this.
4. **Permissions are a local policy table**, never model-generated.
5. **`done` is deferred until the turn is known to be final**, so multi-step runs
   do not end the UI's streaming state early.
6. **Voice, not transcript theatre**: absent recognizers produce a capability
   error, never invented text.
7. **Honest diagnostics**: failed probes yield `null` plus a warning, never a
   fabricated number.

## Remaining issues

- On-device GUI verification outstanding (see `docs/WINDOWS-VALIDATION.md`).
- Browser binaries are not bundled; `npx playwright install chromium` is required
  per machine, and the app reports a capability error until then.
- `type_text` cannot inject into elevated windows (Windows integrity levels).
- `open_application` is an allowlist by design; arbitrary launches are refused.
- Disk/battery reporting is `null` where WMI is blocked.
- Audit trail is in memory only (execution history is persisted; audit is not).
- No signed installer.

## Next implementation step

Wave 1E:
1. Run `docs/WINDOWS-VALIDATION.md` on a real laptop and fix whatever it finds.
2. Persist the audit trail alongside executions so it survives restarts.
3. Bundle Playwright's Chromium into the installer (or download on first use with
   a visible progress state), removing the manual install step.
4. Add the reserved Cyps Code integration point (contract only, no workspace).
