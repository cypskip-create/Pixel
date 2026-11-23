# Hermes vs. Pixel — Authoritative Settings Parity Matrix

**Pinned Hermes Upstream Commit:** `0f602c5f6f18615632535251d62a2db74ce93b69`  
**Total Source-Grounded Denominator:** **161** entries  
**Machine-Readable Source:** [HERMES_SETTINGS_SOURCE_MAP.json](./HERMES_SETTINGS_SOURCE_MAP.json)

| ID | Hermes Setting | Classification | Pixel Equivalent | Implementation | Test Reference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `HSET-001` | `model_context_length` | **Partially implemented** | provider.maxTokens (partial) | `src/shared/types.ts, src/renderer/components/SettingsPanel.tsx` | `tests/settings-api-key.test.tsx` |
| `HSET-002` | `fallback_providers` | **Missing** | None (single primary + reasoning model) | `-` | `-` |
| `HSET-003` | `delegation.model` | **Missing** | None (inherits main model) | `src/main/agents/coordinator.ts` | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts` |
| `HSET-004` | `delegation.provider` | **Missing** | None (inherits active provider) | `src/main/agents/coordinator.ts` | `-` |
| `HSET-005` | `delegation.max_iterations` | **Partially implemented** | SPECIALISTS[id].limits.maxSteps (hardcoded) | `src/main/agents/coordinator.ts` | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts` |
| `HSET-006` | `delegation.max_concurrent_children` | **Implemented and verified** | agent.maxConcurrentSpecialists (1-3, default 3) | `src/shared/types.ts, src/main/agents/coordinator.ts, src/renderer/components/SettingsPanel.tsx` | `tests/phase-g-settings-parity.test.ts` |
| `HSET-007` | `delegation.child_timeout_seconds` | **Partially implemented** | SPECIALISTS[id].limits.timeoutMs (hardcoded) | `src/main/agents/coordinator.ts` | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts` |
| `HSET-008` | `delegation.reasoning_effort` | **Partially implemented** | provider.thinking.effort | `src/shared/types.ts, src/renderer/components/SettingsPanel.tsx` | `tests/settings-api-key.test.tsx` |
| `HSET-009` | `display.personality` | **Missing** | None | `-` | `-` |
| `HSET-010` | `timezone` | **Partially implemented** | routines[].timezone (per-routine IANA) | `src/main/routines/cron.ts, src/main/routines/index.ts` | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts` |
| `HSET-011` | `display.show_reasoning` | **Implemented and verified** | provider.thinking.enabled + reasoning details | `src/shared/types.ts, src/renderer/Workspace.tsx` | `tests/settings-api-key.test.tsx` |
| `HSET-012` | `agent.image_input_mode` | **Implemented and verified** | VISION_MODEL auto-switch (deepseek-flash) | `src/shared/types.ts, src/main/ipc.ts` | `tests/architecture.test.ts` |
| `HSET-013` | `terminal.cwd` | **Partially implemented** | Active project root / FileTools allowedRoot | `src/main/files/toolset.ts, src/main/memory/store.ts` | `tests/files.test.ts` |
| `HSET-014` | `desktop.repo_scan_enabled` | **Missing** | None | `-` | `-` |
| `HSET-015` | `desktop.repo_scan_roots` | **Missing** | None | `-` | `-` |
| `HSET-016` | `desktop.repo_scan_exclude_paths` | **Missing** | None | `-` | `-` |
| `HSET-017` | `code_execution.mode` | **Not applicable** | Deferred (Pixel Code separate product) | `-` | `-` |
| `HSET-018` | `terminal.persistent_shell` | **Missing** | None (no SSH backend) | `-` | `-` |
| `HSET-019` | `terminal.env_passthrough` | **Partially implemented** | McpServerManager restricted env allowlist | `src/main/plugins/mcpManager.ts, python/pixel_agent/mcp_client.py` | `tests/phase-d-mcp-plugins.test.ts` |
| `HSET-020` | `file_read_max_chars` | **Partially implemented** | FileTools bounded read cap | `src/main/files/toolset.ts` | `tests/files.test.ts` |
| `HSET-021` | `approvals.mode` | **Implemented and verified** | companion.mode (guide | hybrid | agent) | `src/shared/types.ts, src/main/agent/tools.ts, src/renderer/components/SettingsPanel.tsx` | `tests/safety.test.ts` |
| `HSET-022` | `approvals.timeout` | **Partially implemented** | None (waits until user decision or abort) | `src/main/agent/runtime.ts` | `tests/safety.test.ts` |
| `HSET-023` | `approvals.mcp_reload_confirm` | **Implemented and verified** | McpServerManager revokes grants on reload/disable | `src/main/plugins/mcpManager.ts` | `tests/phase-d-mcp-plugins.test.ts` |
| `HSET-024` | `command_allowlist` | **Implemented and verified** | PermissionGrantStore (Always Allow scoped grants) | `src/main/agent/permissionStore.ts` | `tests/safety.test.ts` |
| `HSET-025` | `security.redact_secrets` | **Implemented and verified** | redactTaskText + Python crash_log.redact_secrets (always on) | `src/main/tasks/schema.ts, python/pixel_agent/crash_log.py` | `tests/tasks.test.ts` |
| `HSET-026` | `security.allow_private_urls` | **Implemented and verified** | netGuard SSRF protection (always blocks private IPs) | `src/main/agent/netGuard.ts, src/main/plugins/mcpManager.ts` | `tests/phase-d-mcp-plugins.test.ts` |
| `HSET-027` | `checkpoints.enabled` | **Implemented and verified** | TaskStore durable checkpoints (always on) | `src/main/tasks/store.ts, src/main/tasks/recovery.ts` | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts` |
| `HSET-028` | `browser.use_real_profile` | **Missing** | None (isolated Playwright Chromium profile) | `src/main/agent/browser.ts` | `tests/browser.test.ts` |
| `HSET-029` | `browser.allow_private_urls` | **Partially implemented** | netGuard (blocks private URLs by default) | `src/main/agent/netGuard.ts` | `tests/safety.test.ts` |
| `HSET-030` | `browser.auto_local_for_private_urls` | **Missing** | None | `-` | `-` |
| `HSET-031` | `memory.memory_enabled` | **Implemented and verified** | privacy.automaticMemory | `src/shared/types.ts, src/main/memory/autoExtract.ts, src/renderer/components/SettingsPanel.tsx` | `tests/memory.test.ts` |
| `HSET-032` | `memory.user_profile_enabled` | **Implemented and verified** | SessionMemorySnapshotManager (User Profile block) | `src/main/memory/snapshot.ts` | `tests/phase-c-memory-skills.test.ts` |
| `HSET-033` | `memory.memory_char_limit` | **Partially implemented** | SessionMemorySnapshotManager char budget (hardcoded) | `src/main/memory/snapshot.ts` | `tests/phase-c-memory-skills.test.ts` |
| `HSET-034` | `memory.user_char_limit` | **Partially implemented** | SessionMemorySnapshotManager profile budget (hardcoded) | `src/main/memory/snapshot.ts` | `tests/phase-c-memory-skills.test.ts` |
| `HSET-035` | `memory.provider` | **Implemented and verified** | Local SQLite + FTS5 (built-in) | `src/main/memory/store.ts, src/main/history/sessionSearch.ts` | `tests/phase-c-memory-skills.test.ts` |
| `HSET-036` | `context.engine` | **Implemented and verified** | Python pixel-agent-v2 2-stage compressor | `python/pixel_agent/compressor.py` | `python/tests/test_pixel_agent.py` |
| `HSET-037` | `compression.enabled` | **Implemented and verified** | Python pixel-agent-v2 compressor (always on) | `python/pixel_agent/compressor.py` | `python/tests/test_pixel_agent.py` |
| `HSET-038` | `compression.threshold` | **Partially implemented** | compressor.py threshold (hardcoded) | `python/pixel_agent/compressor.py` | `python/tests/test_pixel_agent.py` |
| `HSET-039` | `compression.codex_gpt55_autoraise` | **Not applicable** | Not applicable (OpenAI Codex OAuth specific) | `-` | `-` |
| `HSET-040` | `compression.target_ratio` | **Partially implemented** | compressor.py target ratio (hardcoded) | `python/pixel_agent/compressor.py` | `python/tests/test_pixel_agent.py` |
| `HSET-041` | `compression.protect_last_n` | **Partially implemented** | compressor.py protect_recent (hardcoded) | `python/pixel_agent/compressor.py` | `python/tests/test_pixel_agent.py` |
| `HSET-042` | `auxiliary.compression.timeout` | **Not applicable** | None (deterministic fallback compression) | `python/pixel_agent/compressor.py` | `-` |
| `HSET-043` | `voice.voice_chat_mode` | **Partially implemented** | Push-to-talk chained STT->Agent->TTS | `src/main/voice/voice.ts` | `tests/voice.test.ts` |
| `HSET-044` | `voice.gpt_live.voice` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-045` | `voice.gpt_live.instructions` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-046` | `tts.provider` | **Implemented and verified** | voice.ttsEngine (system | kokoro) | `src/shared/types.ts, src/main/voice/voice.ts, src/renderer/components/SettingsPanel.tsx` | `tests/voice.test.ts` |
| `HSET-047` | `stt.enabled` | **Implemented and verified** | Push-to-talk local faster-whisper | `src/main/voice/voice.ts` | `tests/voice.test.ts` |
| `HSET-048` | `stt.echo_transcripts` | **Missing** | None | `-` | `-` |
| `HSET-049` | `stt.provider` | **Partially implemented** | Local faster-whisper only | `src/main/voice/voice.ts` | `tests/voice.test.ts` |
| `HSET-050` | `stt.streaming` | **Missing** | None | `-` | `-` |
| `HSET-051` | `voice.auto_tts` | **Implemented and verified** | voice.ttsEnabled | `src/shared/types.ts, src/renderer/components/SettingsPanel.tsx` | `tests/voice.test.ts` |
| `HSET-052` | `tts.edge.voice` | **Missing** | None | `-` | `-` |
| `HSET-053` | `tts.openai.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-054` | `tts.openai.voice` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-055` | `tts.elevenlabs.voice_id` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-056` | `tts.elevenlabs.model_id` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-057` | `tts.xai.voice_id` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-058` | `tts.xai.language` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-059` | `tts.xai.speed` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-060` | `tts.xai.auto_speech_tags` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-061` | `tts.xai.optimize_streaming_latency` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-062` | `tts.xai.sample_rate` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-063` | `tts.xai.bit_rate` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-064` | `tts.minimax.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-065` | `tts.minimax.voice_id` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-066` | `tts.mistral.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-067` | `tts.mistral.voice_id` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-068` | `tts.gemini.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-069` | `tts.gemini.voice` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-070` | `tts.neutts.model` | **Missing** | None | `-` | `-` |
| `HSET-071` | `tts.neutts.device` | **Missing** | None | `-` | `-` |
| `HSET-072` | `tts.kittentts.model` | **Missing** | None | `-` | `-` |
| `HSET-073` | `tts.kittentts.voice` | **Missing** | None | `-` | `-` |
| `HSET-074` | `tts.piper.voice` | **Missing** | None | `-` | `-` |
| `HSET-075` | `tts.deepinfra.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-076` | `tts.deepinfra.voice` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-077` | `stt.local.model` | **Implemented and verified** | voice.sttModel (tiny.en | base.en | small.en) | `src/shared/types.ts, src/renderer/components/SettingsPanel.tsx` | `tests/voice-models.test.ts` |
| `HSET-078` | `stt.local.language` | **Missing** | None | `-` | `-` |
| `HSET-079` | `stt.openai.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-080` | `stt.openai.streaming_model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-081` | `stt.groq.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-082` | `stt.mistral.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-083` | `stt.xai.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-084` | `stt.deepinfra.model` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-085` | `stt.elevenlabs.model_id` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-086` | `stt.elevenlabs.language_code` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-087` | `stt.elevenlabs.tag_audio_events` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-088` | `stt.elevenlabs.diarize` | **Blocked by external credentials/platform** | None | `-` | `-` |
| `HSET-089` | `voice.max_recording_seconds` | **Partially implemented** | VoiceService 120s bounded audio limit | `python/tests/test_voice_worker.py` | `python/tests/test_voice_worker.py` |
| `HSET-090` | `voice.client_direct` | **Missing** | None | `-` | `-` |
| `HSET-091` | `toolsets` | **Implemented and verified** | PluginStore + McpServerManager per-project toggles | `src/main/plugins/store.ts, src/main/plugins/mcpManager.ts` | `tests/phase-d-mcp-plugins.test.ts` |
| `HSET-092` | `terminal.backend` | **Partially implemented** | Local Windows host only (no Docker/Singularity/Modal/Daytona) | `src/main/agent/executors.ts` | `tests/safety.test.ts` |
| `HSET-093` | `terminal.timeout` | **Missing** | None | `-` | `-` |
| `HSET-094` | `terminal.docker_image` | **Platform-specific** | None | `-` | `-` |
| `HSET-095` | `terminal.singularity_image` | **Platform-specific** | None | `-` | `-` |
| `HSET-096` | `terminal.modal_image` | **Platform-specific** | None | `-` | `-` |
| `HSET-097` | `terminal.daytona_image` | **Platform-specific** | None | `-` | `-` |
| `HSET-098` | `tool_output.max_bytes` | **Partially implemented** | Python compressor tool-output pruning cap | `python/pixel_agent/compressor.py` | `python/tests/test_pixel_agent.py` |
| `HSET-099` | `tool_output.max_lines` | **Missing** | None | `-` | `-` |
| `HSET-100` | `tool_output.max_line_length` | **Missing** | None | `-` | `-` |
| `HSET-101` | `checkpoints.max_snapshots` | **Missing** | None | `-` | `-` |
| `HSET-102` | `agent.max_turns` | **Implemented and verified** | agent.maxTurns (4-40, default 12) | `src/shared/types.ts, src/renderer/components/SettingsPanel.tsx` | `tests/phase-g-settings-parity.test.ts` |
| `HSET-103` | `agent.api_max_retries` | **Partially implemented** | TaskBudget.maxRetries | `src/shared/types.ts, src/main/agent/budget.ts` | `tests/tasks.test.ts` |
| `HSET-104` | `agent.service_tier` | **Missing** | None | `-` | `-` |
| `HSET-105` | `agent.tool_use_enforcement` | **Missing** | None | `-` | `-` |
| `HSET-106` | `updates.non_interactive_local_changes` | **Missing** | None | `-` | `-` |
| `HSET-107` | `appearance.language` | **Missing** | None | `-` | `-` |
| `HSET-108` | `appearance.introSplash` | **Missing** | None | `-` | `-` |
| `HSET-109` | `appearance.modelPricing` | **Missing** | None | `-` | `-` |
| `HSET-110` | `appearance.resumeLastSession` | **Missing** | None | `-` | `-` |
| `HSET-111` | `appearance.tips` | **Missing** | None | `-` | `-` |
| `HSET-112` | `appearance.tours` | **Missing** | None | `-` | `-` |
| `HSET-113` | `appearance.theme` | **Implemented and verified** | settings.theme (system | dark | light) | `src/shared/types.ts, src/renderer/Workspace.tsx, src/renderer/components/SettingsPanel.tsx` | `tests/monochrome-theme.test.ts` |
| `HSET-114` | `appearance.uiScale` | **Missing** | None | `-` | `-` |
| `HSET-115` | `appearance.chatTextScale` | **Missing** | None | `-` | `-` |
| `HSET-116` | `appearance.chatFont` | **Missing** | None | `-` | `-` |
| `HSET-117` | `appearance.terminalFont` | **Missing** | None | `-` | `-` |
| `HSET-118` | `appearance.interfaceMode` | **Missing** | None | `-` | `-` |
| `HSET-119` | `appearance.sessionDensity` | **Missing** | None | `-` | `-` |
| `HSET-120` | `appearance.tabStrip` | **Missing** | None | `-` | `-` |
| `HSET-121` | `appearance.appActions` | **Missing** | None | `-` | `-` |
| `HSET-122` | `appearance.minimizeToTray` | **Implemented and verified** | Tray-resident companion (close hides to tray) | `src/main/app.ts` | `tests/architecture.test.ts` |
| `HSET-123` | `appearance.translucency` | **Platform-specific** | None | `-` | `-` |
| `HSET-124` | `appearance.backdrop` | **Missing** | None | `-` | `-` |
| `HSET-125` | `appearance.fileBrowser` | **Missing** | None | `-` | `-` |
| `HSET-126` | `appearance.composerPopout` | **Missing** | None | `-` | `-` |
| `HSET-127` | `appearance.userBubble` | **Missing** | None | `-` | `-` |
| `HSET-128` | `appearance.textDirection` | **Missing** | None | `-` | `-` |
| `HSET-129` | `appearance.hideThreadTimeline` | **Missing** | None | `-` | `-` |
| `HSET-130` | `appearance.reactions` | **Missing** | None | `-` | `-` |
| `HSET-131` | `appearance.vibeHearts` | **Missing** | None | `-` | `-` |
| `HSET-132` | `appearance.toolView` | **Implemented and verified** | AgentActivityBar inline expandable pill | `src/renderer/components/AgentActivityBar.tsx` | `tests/agent-activity-bar.test.tsx` |
| `HSET-133` | `appearance.hideCodeDiffs` | **Missing** | None | `-` | `-` |
| `HSET-134` | `appearance.reasoningCollapsed` | **Implemented and verified** | Expandable <details class='workspace-reasoning'> (collapsed by default) | `src/renderer/Workspace.tsx` | `tests/workspace-components.test.tsx` |
| `HSET-135` | `appearance.embeds` | **Missing** | None | `-` | `-` |
| `HSET-136` | `appearance.pet` | **Implemented and verified** | companion.visualMode (stationary | cursor) + Pix mascot | `src/shared/types.ts, src/renderer/components/SettingsPanel.tsx` | `tests/presentation-settings.test.tsx` |
| `HSET-137` | `chat.attachmentSize` | **Missing** | None | `-` | `-` |
| `HSET-138` | `advanced.keepAwake` | **Missing** | None | `-` | `-` |
| `HSET-139` | `advanced.disableF12` | **Missing** | None | `-` | `-` |
| `HSET-140` | `advanced.quickEntry` | **Implemented and verified** | globalAccelerator summon bar | `src/shared/types.ts, src/main/shortcuts.ts` | `tests/architecture.test.ts` |
| `HSET-141` | `advanced.quickEntryShortcut` | **Implemented and verified** | settings.globalAccelerator | `src/shared/types.ts, src/renderer/components/SettingsPanel.tsx` | `tests/presentation-settings.test.tsx` |
| `HSET-142` | `keybinds.hudModifier` | **Missing** | None | `-` | `-` |
| `HSET-143` | `keybinds.screenshot` | **Implemented and verified** | privacy.screenshotRequiresApproval + attach screenshot | `src/shared/types.ts, src/renderer/Workspace.tsx` | `tests/safety.test.ts` |
| `HSET-144` | `notifications.enableAll` | **Missing** | None | `-` | `-` |
| `HSET-145` | `notifications.browserPermission` | **Missing** | None | `-` | `-` |
| `HSET-146` | `notifications.muteSounds` | **Missing** | None | `-` | `-` |
| `HSET-147` | `notifications.completionSound` | **Missing** | None | `-` | `-` |
| `HSET-148` | `sessions.autoArchive` | **Implemented and verified** | privacy.historyRetentionDays | `src/shared/types.ts, src/main/history/store.ts` | `tests/memory.test.ts` |
| `HSET-149` | `gateway.connectionMode` | **Not applicable** | None | `-` | `-` |
| `HSET-150` | `gateway.keychainEncryption` | **Implemented and verified** | Windows DPAPI safeStorage (always on when available) | `src/main/settings.ts` | `tests/settings-api-key.test.tsx` |
| `HSET-151` | `gateway.diagnostics` | **Implemented and verified** | collectDiagnostics + Diagnostics view | `src/main/system/diagnostics.ts` | `tests/architecture.test.ts` |
| `HSET-152` | `about.updates` | **Missing** | None | `-` | `-` |
| `HSET-153` | `view:providers` | **Partially implemented** | Single provider (DeepSeek) implemented; multi-provider hub missing | `src/main/providers/deepseek.ts` | `tests/settings-api-key.test.tsx` |
| `HSET-154` | `view:keys` | **Partially implemented** | DeepSeek API key + GitHub PAT + Google Calendar DPAPI storage | `src/main/settings.ts` | `tests/settings-api-key.test.tsx` |
| `HSET-155` | `view:connections` | **Implemented and verified** | External Connections & MCP | `src/main/plugins/mcpManager.ts, src/renderer/components/WorkspacePluginManager.tsx` | `tests/phase-d-mcp-plugins.test.ts` |
| `HSET-156` | `view:plugins` | **Implemented and verified** | Plugins Catalog & Lifecycle | `src/main/plugins/store.ts, src/renderer/components/WorkspacePluginManager.tsx` | `tests/phase-d-mcp-plugins.test.ts` |
| `HSET-157` | `view:vault` | **Partially implemented** | DPAPI encrypted credential files (no generic arbitrary-env vault UI) | `src/main/settings.ts` | `tests/settings-api-key.test.tsx` |
| `HSET-158` | `view:backup` | **Missing** | Memory JSON export only; full profile archive export/import missing | `src/main/memory/store.ts` | `tests/memory.test.ts` |
| `HSET-159` | `view:web-access` | **Not applicable** | Not applicable (Pixel is a local Windows desktop companion) | `-` | `-` |
| `HSET-160` | `view:billing` | **Not applicable** | Not applicable (Hermes Cloud proprietary billing) | `-` | `-` |
| `HSET-161` | `view:about.uninstall` | **Implemented and verified** | Uninstall / Data Cleanup | `tests/nsis.test.ts` | `tests/nsis.test.ts` |
