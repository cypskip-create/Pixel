# Interaction Engine 3.0 release-readiness report

Date: 2026-11-18
Branch: `codex/interaction-engine-3`
Base commit: `b7ccac1fc17824317a1606f5b89bb61a13bbc52d`
GitHub status: local-only; no push or release was made.

## Readiness summary

The source implementation and automated regression suite are ready for laptop
acceptance. This is **not yet a Windows release candidate that has passed GUI
acceptance**: Electron cannot start in this environment, so the actual Island,
Workspace, microphone, PTT focus behavior and packaged launch were not observed.

| Status | Capabilities |
| --- | --- |
| Implemented | Reducer-driven compact Island; fixed per-surface geometry; internal response scrolling; configured global PTT chord; narrowly scoped native release helper; bounded audio capture; local transcription routes; one-shot PTT submission; manual dictation draft behavior; shared runtime/character state; cool blue-charcoal Workspace styling; CI steps for Windows checks, packaging and artifact upload. |
| Partially verified | PTT state transitions, cancellation, timeout and crash recovery are unit-tested. Native helper compiles and accepts the configured chord. Offline transcription code and audio limits are unit-tested. An unpacked Windows build was produced and its archived preload/helper inspected. |
| Unverified | Visible development or packaged app, sandbox smoke execution, microphone permission/capture, spoken transcript accuracy, no-focus PTT on a real foreground app, approval/emergency behavior in the real UI, DPI/multi-monitor visuals, GPU-enabled and disabled comparison, portable launch, clean install/upgrade/uninstall, data preservation, CPU/memory/latency on a speech workload. |
| Missing acceptance evidence | Hardware-backed voice test and visual screenshots. The real Windows foreground integration remains opt-in and was skipped. No GitHub Actions run exists for this local, unpushed branch. |

## Test and build evidence

- `npm run typecheck`: passed.
- `npm test -- --reporter=dot`: **781 passed, 0 failed, 2 skipped (783 total; 45 files passed, 1 skipped)**. Playwright Chromium was installed and local fixture access was enabled for the Windows runner. The two skipped tests are the opt-in real-desktop foreground integration checks.
- `npx vitest run tests/browser.test.ts --reporter=dot`: **22/22 passed** with local fixture access enabled.
- `npx vitest run tests/nsis.test.ts --reporter=verbose`: **9/9 passed** in the Windows test context.
- `npm run build`: passed (main, bundled preload, renderer and icon).
- `npm run build:native`: passed. `PixelNative.exe --watch-ptt-release Control+Shift+Space` printed `released` and exited 0 when the chord was not held.
- The isolated unpacked package command passed and wrote `artifacts/interaction-engine-3-rc-20261118/win-unpacked`. The archive contains `dist/main/preload/index.js`; inspection found only `electron` as a runtime `require`, no local CommonJS import, and both bridge names. `resources/native/PixelNative.exe` is present.
- `npm run test:preload-sandbox`: blocked before the smoke renderer ran. Electron 45.2.3 exited with `2147483651` (`0x80000003`); no smoke JSON was produced.
- Electron `--version` returned `0x80000003` in this host. The development launch likewise exited before current-branch startup logs or a window. The already-visible `C:\dev\Pixel` process is a different checkout and was not counted as a pass.
- The first default `npm run pack` attempt could not resolve `github.com` (`ENOTFOUND`). The isolated package succeeded after network-enabled packaging was permitted; no signing, publishing or installer distribution was requested.

## Remaining defects and limits

1. Do not mark UI/voice acceptance complete until the exact steps in
   [`PIXEL_WINDOWS_ACCEPTANCE.md`](PIXEL_WINDOWS_ACCEPTANCE.md) run on the
   target laptop. Verify PTT while Chrome/VS Code/Notepad has focus and confirm
   the user retains focus and receives one accurate transcript.
2. The Electron host failure prevents the real sandboxed preload smoke and GUI
   checks here. The packaged GPU/renderer-child-process issue remains separate
   and undiagnosed; the current process failure happens before Pixel's main
   entry point and does not establish a GPU root cause.
3. A local Windows capability probe reported `speechToText=true` and
   `textToSpeech=true` in the full test context; the sandboxed probe reported
   STT unavailable. No microphone or acoustic accuracy was measured. Optional
   faster-whisper was not installed; it is CPU/int8 and requires the user to
   install/cache a model separately.
4. CPU use, memory use, transcription latency, 20-second clip behavior on real
   hardware, 100/125/150% DPI, monitor/taskbar placement, and window
   click-through were not measured visually.
5. CI configuration already runs Windows typecheck, sandbox smoke, tests,
   native compilation, packaging and artifact upload. It has not run against
   this local branch because no push occurred.

No changes were made to installation identity, user-data paths, credential
storage, installer repair behavior or release publishing.
