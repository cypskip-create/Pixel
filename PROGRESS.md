# Cyps progress

Updated: Wave 1 foundation complete (1A-1C core, 1D groundwork).

## Current milestone

**Wave 1C is functionally complete** for the text path end to end: floating
shell, secure credentials, DeepSeek streaming client, conversation engine,
history, modes, permission policy, diagnostics, packaging.

## Completed

### Wave 1A - foundation
- Project scaffold: TypeScript strict, Vite 8, React 19, Tailwind v4, Vitest.
- `src/shared/types.ts` as the single cross-process contract (frozen).
- `src/shared/channels.ts` IPC names, `src/shared/surfaces.ts` geometry.
- DeepSeek provider: wire format, SSE parsing, thinking mode, vision gating,
  error mapping, cost estimation, history trimming. 36 tests.
- Environment findings documented in `docs/ENVIRONMENT.md`,
  `docs/ELECTRON-CONSTRAINTS.md`, `docs/DEEPSEEK-API.md`.

### Wave 1B - floating UI
- `main` window: frameless, transparent, always-on-top at `floating` level
  (deliberately below system dialogs), 96px idle orb, 480px expanded surfaces.
- Position persistence with work-area clamping and display-change re-clamping.
- Tray with mode submenu, settings, emergency stop, quit; icon generated at
  runtime, failure tolerated.
- Global shortcuts, best-effort registration with conflict handling.
- React UI: 8-state avatar, compact input bar, streaming bubble with separate
  reasoning view, mode switcher, permission card, task strip, settings window.
- Accessibility: labelled controls, focus-visible rings, `aria-live` answer
  region, `prefers-reduced-motion` honoured.

### Wave 1C - working AI
- DPAPI-encrypted API key via `safeStorage`; refuses plaintext fallback.
- Key never returned to the renderer, never logged, never in error text.
- Conversation engine: system prompt with hard safety rules, stop checks before
  and during a turn, vision-model auto-upgrade, typed error events.
- Streaming to the UI with requestId pairing and pre-resolve event buffering.
- History persistence with caps and corrupt-file recovery.
- Settings window with connection test.
- Screen capture module with per-action authorization and DPI-correct sizing.

### Wave 1D groundwork
- Tool registry with 5 built-in tools and a real permission policy (21 tests).
- Guide mode cannot run a state-changing tool; enforced in code.
- Emergency stop: halts tools, cancels tasks, revokes grants, aborts stream,
  reports completed actions honestly.
- Audit log, permission broker, task manager.

### Release
- `electron-builder` config, per-user NSIS installer target, generated icon.
- The app packages successfully to `release/win-unpacked/Cyps.exe`.

## Verification status

| Check | Result |
| --- | --- |
| `tsc` main program | pass |
| `tsc` renderer program | pass |
| `vitest` | 147 tests pass |
| `vite build` | pass |
| compiled main bundle loads as CJS | pass (7/7 modules) |
| `electron-builder --win --dir` | pass |
| GUI window appears / tray / shortcuts / capture | **not verifiable here** |

This machine cannot start any Chromium GUI process: `app.whenReady()` alone
crashes with an access violation, and the packaged app exits immediately with
crashpad "not connected". Details and evidence in
`docs/ELECTRON-CONSTRAINTS.md`. Those paths are compiled and packaged, not
tested, and nothing in the README claims otherwise.

## Architectural decisions

1. **Electron instead of Tauri.** Rust could not be installed (the toolchain
   directory is not writable in this environment). The renderer/preload contract
   was kept shell-agnostic so a Tauri migration touches only `src/main` and
   `src/preload`.
2. **CommonJS for main/preload**, marked by a generated `dist/main/package.json`.
   The root stays `"type": "module"` for the renderer tooling.
3. **IPC channel names live in `shared`.** Importing them from the preload into
   the main process executed `contextBridge` in the main process and killed the
   app at startup. An architecture test now prevents a repeat.
4. **Permissions are a local policy table**, never model-generated.
5. **Honest diagnostics.** When a probe fails the value is `null` plus a warning,
   never a fabricated zero.
6. **No fabricated UI state.** Voice reports itself unavailable; agent progress
   only reflects real tool events.

## Outstanding

- Wave 1D: actual tool execution loop (approval -> execute -> result),
  Playwright/browser tool, push-to-talk and STT/TTS.
- Wave 1E: on-device verification of window, tray, shortcuts, drag, capture on a
  real desktop; DPI pass; signed installer.
- Screenshot of the running UI (impossible in this environment).
- Python/FastAPI backend: not needed; the main process covers the contract.

## Known issues

- Disk and battery reporting is `null` where WMI is blocked (this machine).
- `npm install` needs `--ignore-scripts` here; Electron's binary must be fetched
  with `node node_modules/electron/install.js`.
- Tray/mode-change is delivered to the renderer over a small `window.cypsShell`
  surface outside `CypsBridge`, to keep the specified contract untouched.

## Next implementation step

Implement the agent execution loop in `src/main/agent`: when
`ConversationEngine` emits `tool_calls`, evaluate each against
`ToolRegistry.evaluate`, raise a `PermissionRequest` through `PermissionBroker`
when required, and feed the tool result back as a `tool` message for the next
turn - emitting real `TaskRecord` progress throughout.
