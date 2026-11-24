# Pixel — Stage 4, 5 & 6 + Python-First Runtime Acceptance Evidence

## 1. Automated Verification Results
- **Scope Guard (`npm run check:scope`):** `SCOPE_GUARD_OK` (0 forbidden trees).
- **TypeScript Typecheck (`npm run typecheck`):** 0 errors across `tsconfig.json` and `tsconfig.main.json`.
- **Production Build (`npm run build`):** PASS (`dist/main`, `dist/renderer`, `build/icon.png`).
- **C# Native Helper (`scripts/build-native.ps1`):** `PixelNative.exe` compiled cleanly with 0 errors (`focus_window`, `mouse_action`, `send_keys` added).
- **Python `unittest` (`python -m unittest discover -s python/tests -v`):** **30/30 OK**, including `python/tests/test_python_first_stage4_6.py`:
  - Pure-Python Set-of-Marks PNG pixel-level bounding-box & numbered badge verification
  - Vision capability validation & image history budgeting
  - `run_agent_turn` multimodal `image_url` forwarding to vision models & honest fallback for text-only models
  - Cloud STT/TTS/GPT-Live local-only privacy enforcement & `runtime.diagnostics` RPC
- **Vitest Integration Suite (9 files, 141/141 PASS):**
  - `tests/python-first-stage4-6-integration.test.ts` (5/5)
  - `tests/architecture.test.ts` (18/18)
  - `tests/monochrome-theme.test.ts` (7/7)
  - `tests/hermes-stage5-browser-computer-use.test.ts` (8/8)
  - `tests/hermes-stage6-voice-multimodal.test.ts` (4/4)
  - `tests/hermes-stage3-stage4-functional.test.ts` (5/5)
  - `tests/voice.test.ts` (25/25)
  - `tests/phase-g-settings-parity.test.ts` (3/3)
  - `tests/safety.test.ts` (66/66)

## 2. External Prerequisites & Honest Environment Limitations
- **Live Cloud Credentials:** Cloud STT/TTS, OpenAI GPT-Live WebRTC, and OpenAI/FAL.ai image generation are wired end-to-end through Python and Electron IPC; live paid API calls require user-supplied credentials in Settings.
- **Sandboxed Windows Host Desktop Limit:** On this sandboxed build host, bare `electron.exe` exits with `0x80000003` (`STATUS_BREAKPOINT`) and `PixelNative.exe` runtime smoke exits with `0x8007045A` (`ERROR_DLL_INIT_FAILED`) due to sandboxed Win32 desktop/DLL initialization limits. Full Windows runtime, preload bridge, native helper smoke, Playwright Chromium, and NSIS installer verification are executed on GitHub Actions Windows CI.
