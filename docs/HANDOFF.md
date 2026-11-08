# Pixel handoff (resume here)

Branch: `merge/round4-onto-main`, built on `origin/main` (`2e7d11a`, PR #7).

## Done and unit-tested
- Scoped approvals, real cancellation (`AbortSignal`), DNS-aware browser guard, JSONL audit.
- Companion state machine, geometry, cursor follower, pointing logic, push-to-talk races.
- Orb states come from `main`'s `AssistantState`; `deriveCompanionState` delegates to `deriveAssistantState`.
- Validated companion settings (`visualMode`, `followSpeed`, `animations`, `transientMode`...).
- Native client (`src/main/services/nativeHelper.ts`) tested against a fake process.

## Written but NOT run
- `native/PixelNative/PixelNative.cs` + `scripts/build-native.ps1` (no .NET here).
- `scripts/repair-install-state.ps1` (no PowerShell here).

## Not started (next, in this order)
1. Confirm the unpacked app launches on the laptop (docs/WINDOWS-VALIDATION.md §7.1).
2. Cursor-companion window controller (main, TS) driving `stepFollower` with a poll that backs
   off and stops when `isSettled`; React overlay loaded via `index.html?view=cursor`.
3. Wire `find_elements` into `analyze_screen`/a `point_at` tool, with vision fallback gated on
   `modelSupportsVision()`.
4. Native keyboard hook (`key_events`) for true push-to-talk release.
5. Transcription provider interface; audio-level waveform.
6. SQLite audit sink (needs `src/main/data/database.ts`; keep the JSONL sink as fallback).

## Known gaps
- `type_text` still uses `SendKeys` into whatever window is focused at execution time.
- `browser_click`/`browser_type` grants are not origin-scoped (only `browser_navigate` is).
- DNS rebinding is detected after the fact, not prevented (needs an egress proxy).