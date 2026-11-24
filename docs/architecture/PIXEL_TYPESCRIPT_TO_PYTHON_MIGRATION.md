# Pixel — TypeScript to Python Migration Ledger

**Hermes Reference Revision:** `352b249f67fb6a4a7d7904acaca9dd410db229e0` (kept strictly outside Pixel at `C:\dev\pixel-research\hermes-agent`)

## Module Migration Classification

| Subsystem | Original Pixel Location | Target Authoritative Location | Hermes Reference | Status |
|---|---|---|---|---|
| Primary Agent Loop & Budgets | `src/main/agent/executor.ts` | `python/pixel_agent/loop.py` + `budgets.py` + `compressor.py` | `run_agent.py`, `agent/` | **Default runtime (`python`)** |
| Multi-Provider Streaming & Fallbacks | `src/main/providers/` | `python/pixel_agent/providers.py` (OpenAI-compat, DeepSeek, Anthropic + multimodal image blocks, Ollama) | `providers/` | **Active in Python** |
| Multimodal Vision, History Budget, Image Gen & Set-of-Marks PNG Annotation | `src/main/agent/multimodal.ts` | `python/pixel_agent/multimodal.py` (pure-Python stdlib PNG codec + SoM renderer + vision check + OpenAI/FAL gen) | `tools/vision_tools*.py`, `tools/computer_use/`, `tools/image_generation_tool.py` | **Active in Python (wired via `PythonAgentBridge`)** |
| Cloud STT / TTS & GPT-Live SDP Broker | `src/main/voice/providers.ts`, `conversationMode.ts` | `python/pixel_agent/voice.py` (routed from `VoiceService` & `ipc.ts` via `PythonAgentBridge`) | `tools/transcription_audio.py`, `tools/tts_tool_providers.py`, `tools/voice_live.py` | **Active in Python (wired via `VoiceService` + `ipc.ts`)** |
| Interactive Terminal & Process Ownership | `src/main/services/terminalService.ts` | Retained in Electron main for direct Windows process-tree control (`taskkill /T /F`) & fail-closed `ownerId` enforcement; orchestrated by Python tool calls | `tools/process_registry*.py`, `tools/terminal_tool*.py` | **Retained in TS + upgraded** |
| Browser Automation, Persistent Profiles & CDP | `src/main/agent/browser.ts` (`BrowserSessionManager`) | Retained in Electron main with Playwright Node runtime + `NetworkGuard` + `launchPersistentContext` + CDP existing-context selection | `tools/browser_session*.py`, `tools/browser_url_policy.py` | **Retained in TS + upgraded** |
| Windows UIA & Win32 Input | `native/PixelNative/PixelNative.cs` | Retained & extended in C# (`focus_window`, `mouse_action`, `send_keys`) | `tools/computer_use/cua_backend_input.py` | **Retained & extended in C#** |
| Desktop UI, Preload, Permissions, SQLite | `src/renderer/`, `src/preload/`, `src/main/ipc.ts`, `src/main/data/` | Retained in TypeScript/Electron | `apps/desktop/` | **Retained in TS** |
