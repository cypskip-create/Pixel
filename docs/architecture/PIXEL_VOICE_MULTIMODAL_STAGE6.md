# Pixel Stage 6 Architecture — Hermes Voice Providers, Continuous/GPT-Live Voice & Multimodal

**Hermes Reference Revision:** `352b249f67fb6a4a7d7904acaca9dd410db229e0` (`C:\dev\pixel-research\hermes-agent`)

## 1. Hermes Sources Analyzed
- `hermes_cli/config_defaults_voice.py` (voice chat mode, barge-in, silence thresholds, stop phrases, cues)
- `tools/tts_tool_providers.py` (Edge, ElevenLabs, xAI, MiniMax, Mistral, Gemini, OpenAI TTS + 16 MiB body cap)
- `tools/voice_live.py` (full-duplex GPT-Live WebRTC SDP server-side exchange & client-delegation persona)
- `tools/image_generation_tool.py` & `tools/vision_tools_history_budget.py`

## 2. Pixel Implementation
- **Speech Provider Adapters (`src/main/voice/providers.ts`):**
  - STT: `local` (on-device Whisper/Windows, zero cloud egress), `openai`, `mistral`, `deepgram`, `custom`.
  - TTS: `system`, `kokoro`, `edge`, `openai`, `elevenlabs`, `xai`, `gemini`, `minimax`, `mistral` with 16 MiB response cap and sentence-level speech segmentation (`splitIntoSpeechSegments`).
- **Continuous Voice, Barge-In & Full-Duplex GPT-Live (`src/main/voice/conversationMode.ts`):**
  - `ContinuousVoiceController`: silence end-of-speech detection, pre-playback quiet-room RMS floor calibration, `bargeInGraceSec` + `bargeInThresholdMultiplier` echo suppression, stop-phrase detection.
  - `exchangeGptLiveSdpOffer`: server-side `POST /v1/live/sessions` SDP exchange keeping OpenAI API keys strictly in Electron main.
- **Multimodal & Image Generation (`src/main/agent/multimodal.ts`, `tools.ts`, `executors.ts`):**
  - `image_generate` tool (OpenAI `gpt-image-1` & FAL.ai Flux) writing verified PNG artifacts into Pixel's `artifacts/images` directory.
  - `assertVisionCapableModel` + `enforceImageHistoryBudget` preventing silent failures on text-only models and bounding image context usage.
- **Voice Settings Parity (`src/shared/types.ts`, `src/renderer/components/SettingsPanel.tsx`):**
  - Full Hermes voice configuration surface (multilingual Whisper models `tiny`/`base`/`small`/`large-v3-turbo`, voice chat mode, STT/TTS providers, language, submit mode, barge-in, silence thresholds, audio cues, GPT-Live voice/instructions).
