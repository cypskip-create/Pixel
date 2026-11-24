# Pixel — Stage 4, Stage 5 & Stage 6 Final Completion Summary

**Base Commit:** `540d8b079f749a20a93ae916ca8bfa871bfded59`  
**Hermes Reference:** `352b249f67fb6a4a7d7904acaca9dd410db229e0` (external checkout)  
**Stage 7 Status:** Not started (per directive).

---

## Stage 4C — Terminal Architecture & Fail-Closed Process Ownership
- **Fixed `TerminalService.checkOwnership()`** in `src/main/services/terminalService.ts`: strictly fail-closed — missing `ownerId` no longer bypasses ownership for owned processes. Added explicit `adminKillAll()` for Emergency Stop & app shutdown.
- **Persistent Interactive Shell Sessions:** Added `openShell()` (`powershell`, `cmd`, `pwsh`, `sh`), `resize()`, `sendInterrupt()`, and `readOutput()` to `TerminalService`.
- **Trusted Runtime Ownership & Tools:** Propagated trusted runtime `ownerId` (`conversationId ?? projectId ?? taskId`) from `PythonAgentRunner` → `ToolExecutors.run()` into every `process_*` and `terminal_*` tool (`terminal_open`, `terminal_write`, `terminal_read`, `terminal_resize`, `terminal_close`) and wired IPC channels `terminal:openShell`, `terminal:write`, `terminal:resize`, `terminal:read`, `terminal:close`.

## Stage 5C — Multi-Session Browser, Persistent Profiles, CDP & Computer Use
- **`BrowserSessionManager` (`src/main/agent/browser.ts`):** Independent owner-scoped browser sessions, max-session cap, inactivity pruning, `browser:sessions` IPC, and Emergency Stop cleanup.
- **Real `launchPersistentContext()`:** `profileMode: 'pixel_persistent_profile'` launches Playwright with a Pixel-managed persistent `userDataDir` (`mode === 'pixel_persistent'`).
- **Authorized CDP Existing-Context Selection:** `connectOverCDP()` discovers existing `browser.contexts()` and `context.pages()` (`mode === 'cdp_attached_existing'`) and `close()` disconnects without terminating the user's browser or existing context.
- **Computer Use Isolation (`src/main/agent/computerUse.ts`):** Replaced global `lastSnapshot` with `Map<string, ComputerUseSnapshot>` keyed by trusted `scopeKey` + `snapshotId` verification, plus `DesktopInputLease` acquisition on mutating `computer_use` calls in `ToolExecutors`.
- **Real Set-of-Marks PNG Annotation (`python/pixel_agent/multimodal.py`):** Pure-Python stdlib PNG codec + bounding-box & numbered badge renderer wired via `PythonAgentBridge.annotateSomPng()` into `ComputerUseController` (`som` mode).
- **Multimodal Screenshot Delivery:** `ToolResult.image` → `PythonToolResponse.image` → `python/pixel_agent/loop.py` attaches `image_url` blocks for vision-capable models (with Anthropic base64 `image` block translation in `providers.py` and image history budgeting), and honest text fallback for text-only models.
- **Full Windows Foreground Actions (`native/PixelNative/PixelNative.cs`):** Added HWND-revalidated `focus_window`, `mouse_action` (`click`, `double_click`, `right_click`, `middle_click`, `drag`), and `send_keys` (single keys + combos), gated by `allowForegroundFallback`. Compiled cleanly to `native/bin/PixelNative.exe`.

## Stage 6B — Connected Voice Runtime, Multilingual Models, Continuous Voice, GPT-Live & Multimodal
- **Connected `VoiceService` (`src/main/voice/voice.ts`):** `transcribeWav()` and `speak()` now route cloud STT/TTS providers through Python (`python/pixel_agent/voice.py` via `PythonAgentBridge`) with local-only privacy enforcement, sentence segmentation, and temp WAV playback cleanup.
- **Complete Multilingual Model Catalog (`src/main/voice/models.ts`):** Added `tiny`, `base`, `small`, and `large-v3-turbo` alongside `tiny.en`, `base.en`, `small.en`, and `kokoro-v1.0-int8`; fixed `resolveWhisperModel()` so multilingual model IDs are preserved.
- **Connected Continuous Voice & GPT-Live IPC (`src/main/ipc.ts`):** Instantiated `ContinuousVoiceController` with `voice:continuousStart`, `voice:continuousStop`, `voice:continuousFrame`, `voice:continuousState` (connected to barge-in & Emergency Stop), and wired `voice:gptLiveOffer` server-side SDP negotiation through Python (`voice.gpt_live_sdp`) keeping OpenAI keys strictly out of the renderer.
- **Dedicated FAL Credential & Artifact Previews (`src/shared/types.ts`, `src/main/agent/executors.ts`):** Added dedicated `'fal'` provider slot in `PROVIDER_IDS`/`PROVIDER_CATALOG` (no longer reusing `'custom'`), and returned generated PNG previews in `ToolResult.image`.
