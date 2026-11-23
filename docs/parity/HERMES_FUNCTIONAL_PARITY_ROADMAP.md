# Hermes Functional Parity Expansion Roadmap (Post-Phase G)

Derived from the **161**-entry source-grounded inventory (`0f602c5f6f18615632535251d62a2db74ce93b69`).

## Priority Tier 1 — High-Value Local Capabilities (Existing Backend Foundations)
1. **Delegation & Runtime Tuning:** Expose `delegation.max_iterations`, `delegation.child_timeout_seconds`, `memory.memory_char_limit`, `memory.user_char_limit`, `compression.threshold`, `compression.target_ratio`, `compression.protect_last_n`, and `agent.api_max_retries` in Settings (backends already exist in Phases A, C, and E).
2. **Global Timezone & Chat Display Preferences:** Add global default IANA timezone (feeding `LocalRoutineScheduler`), UI text/chat scale (`uiScale`, `chatTextScale`), compact/comfortable sidebar density, and code-diff visibility toggles.
3. **Notifications & Sounds:** Add per-category Windows native notification toggles and completion sound/mute controls.
4. **Full Profile Backup & Transfer:** Extend memory JSON export into a complete encrypted/redacted profile backup & restore archive.

## Priority Tier 2 — New Backend Subsystems Required
1. **Multi-Provider Model Hub & Fallback Chains:** Add OpenRouter, Anthropic, OpenAI, Gemini, xAI, and custom OpenAI-compatible local/remote endpoints (`fallback_providers`, `delegation.model`, `delegation.provider`).
2. **Real Browser Profile Snapshot Mode:** Add optional managed Chromium profile snapshot cloning (`browser.use_real_profile`) with strict opt-in consent.
3. **Automatic Local Repository Discovery:** Add opt-in folder scanning (`desktop.repo_scan_*`) for Projects.
4. **Generic Encrypted Secrets Vault:** Extend DPAPI `SettingsStore` into a generic named-credential vault for MCP and custom provider keys.

## Priority Tier 3 — Externally Blocked / Platform-Specific / Non-Applicable
- **Externally Blocked (29 entries):** Third-party cloud STT/TTS providers (`tts.openai.*`, `tts.elevenlabs.*`, `tts.xai.*`, `tts.gemini.*`, `stt.openai.*`, `stt.groq.*`, `stt.elevenlabs.*`, `voice.gpt_live.*`) — require user-owned third-party API keys and provider adapters.
- **Platform-Specific (5 entries):** Container terminal backends (`docker`, `singularity`, `modal`, `daytona`) and OS-specific translucency.
- **Not Applicable (6 entries):** Hermes Cloud proprietary billing (`billing`), remote Hermes Webapp (`web-access`), remote Hermes Gateway mode (`gateway.connectionMode`), OpenAI Codex OAuth compression auto-raise, and Pixel Code (`code_execution.mode`, separate future product).
