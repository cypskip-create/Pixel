# Hermes Desktop Settings — Exhaustive Source-Grounded Inventory

**Pinned Hermes Upstream Commit:** `0f602c5f6f18615632535251d62a2db74ce93b69`
**Total Inventoried Settings:** **161** (106 config schema keys + 46 desktop manifest entries + 9 dedicated settings views)

## Summary Counts

| Classification | Count |
| :--- | ---: |
| Blocked by external credentials/platform | 31 |
| Implemented and verified | 34 |
| Missing | 61 |
| Not applicable | 6 |
| Partially implemented | 24 |
| Platform-specific | 5 |

## Complete Inventory

| ID | Category | Subcategory | Key / Label | Kind | Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `HSET-001` | Model | main | `model_context_length` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-002` | Model | fallbacks | `fallback_providers` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-003` | Model | delegation | `delegation.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-004` | Model | delegation | `delegation.provider` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-005` | Model | delegation | `delegation.max_iterations` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-006` | Model | delegation | `delegation.max_concurrent_children` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-007` | Model | delegation | `delegation.child_timeout_seconds` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-008` | Model | delegation | `delegation.reasoning_effort` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-009` | Chat | behavior | `display.personality` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-010` | Chat | behavior | `timezone` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-011` | Chat | behavior | `display.show_reasoning` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-012` | Chat | attachments | `agent.image_input_mode` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-013` | Workspace | projects | `terminal.cwd` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-014` | Workspace | projects | `desktop.repo_scan_enabled` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-015` | Workspace | projects | `desktop.repo_scan_roots` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-016` | Workspace | projects | `desktop.repo_scan_exclude_paths` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-017` | Workspace | files | `code_execution.mode` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-018` | Workspace | shell | `terminal.persistent_shell` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-019` | Workspace | shell | `terminal.env_passthrough` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-020` | Workspace | files | `file_read_max_chars` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-021` | Safety | approvals | `approvals.mode` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-022` | Safety | approvals | `approvals.timeout` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-023` | Safety | approvals | `approvals.mcp_reload_confirm` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-024` | Safety | approvals | `command_allowlist` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-025` | Safety | privacy | `security.redact_secrets` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-026` | Safety | privacy | `security.allow_private_urls` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-027` | Safety | output | `checkpoints.enabled` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-028` | Browser | profile | `browser.use_real_profile` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-029` | Browser | network | `browser.allow_private_urls` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-030` | Browser | network | `browser.auto_local_for_private_urls` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-031` | Memory & Context | persistent | `memory.memory_enabled` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-032` | Memory & Context | persistent | `memory.user_profile_enabled` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-033` | Memory & Context | persistent | `memory.memory_char_limit` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-034` | Memory & Context | persistent | `memory.user_char_limit` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-035` | Memory & Context | persistent | `memory.provider` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-036` | Memory & Context | context | `context.engine` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-037` | Memory & Context | context | `compression.enabled` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-038` | Memory & Context | context | `compression.threshold` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-039` | Memory & Context | context | `compression.codex_gpt55_autoraise` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-040` | Memory & Context | context | `compression.target_ratio` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-041` | Memory & Context | context | `compression.protect_last_n` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-042` | Memory & Context | auxiliary | `auxiliary.compression.timeout` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-043` | Voice | conversation | `voice.voice_chat_mode` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-044` | Voice | conversation | `voice.gpt_live.voice` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-045` | Voice | conversation | `voice.gpt_live.instructions` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-046` | Voice | speech | `tts.provider` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-047` | Voice | transcription | `stt.enabled` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-048` | Voice | transcription | `stt.echo_transcripts` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-049` | Voice | transcription | `stt.provider` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-050` | Voice | transcription | `stt.streaming` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-051` | Voice | speech | `voice.auto_tts` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-052` | Voice | speech | `tts.edge.voice` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-053` | Voice | speech | `tts.openai.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-054` | Voice | speech | `tts.openai.voice` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-055` | Voice | speech | `tts.elevenlabs.voice_id` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-056` | Voice | speech | `tts.elevenlabs.model_id` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-057` | Voice | speech | `tts.xai.voice_id` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-058` | Voice | speech | `tts.xai.language` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-059` | Voice | speech | `tts.xai.speed` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-060` | Voice | speech | `tts.xai.auto_speech_tags` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-061` | Voice | speech | `tts.xai.optimize_streaming_latency` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-062` | Voice | speech | `tts.xai.sample_rate` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-063` | Voice | speech | `tts.xai.bit_rate` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-064` | Voice | speech | `tts.minimax.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-065` | Voice | speech | `tts.minimax.voice_id` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-066` | Voice | speech | `tts.mistral.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-067` | Voice | speech | `tts.mistral.voice_id` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-068` | Voice | speech | `tts.gemini.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-069` | Voice | speech | `tts.gemini.voice` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-070` | Voice | speech | `tts.neutts.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-071` | Voice | speech | `tts.neutts.device` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-072` | Voice | speech | `tts.kittentts.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-073` | Voice | speech | `tts.kittentts.voice` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-074` | Voice | speech | `tts.piper.voice` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-075` | Voice | speech | `tts.deepinfra.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-076` | Voice | speech | `tts.deepinfra.voice` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-077` | Voice | transcription | `stt.local.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-078` | Voice | transcription | `stt.local.language` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-079` | Voice | transcription | `stt.openai.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-080` | Voice | transcription | `stt.openai.streaming_model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-081` | Voice | transcription | `stt.groq.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-082` | Voice | transcription | `stt.mistral.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-083` | Voice | transcription | `stt.xai.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-084` | Voice | transcription | `stt.deepinfra.model` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-085` | Voice | transcription | `stt.elevenlabs.model_id` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-086` | Voice | transcription | `stt.elevenlabs.language_code` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-087` | Voice | transcription | `stt.elevenlabs.tag_audio_events` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-088` | Voice | transcription | `stt.elevenlabs.diarize` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-089` | Voice | conversation | `voice.max_recording_seconds` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-090` | Voice | conversation | `voice.client_direct` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-091` | Advanced | tools | `toolsets` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-092` | Advanced | terminal | `terminal.backend` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-093` | Advanced | terminal | `terminal.timeout` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-094` | Advanced | terminal | `terminal.docker_image` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-095` | Advanced | terminal | `terminal.singularity_image` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-096` | Advanced | terminal | `terminal.modal_image` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-097` | Advanced | terminal | `terminal.daytona_image` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-098` | Advanced | output | `tool_output.max_bytes` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-099` | Advanced | output | `tool_output.max_lines` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-100` | Advanced | output | `tool_output.max_line_length` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-101` | Advanced | output | `checkpoints.max_snapshots` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-102` | Advanced | runtime | `agent.max_turns` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-103` | Advanced | runtime | `agent.api_max_retries` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-104` | Advanced | runtime | `agent.service_tier` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-105` | Advanced | tools | `agent.tool_use_enforcement` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-106` | Advanced | desktop | `updates.non_interactive_local_changes` | config_schema | `apps/desktop/src/app/settings/constants.ts#SECTIONS` |
| `HSET-107` | Appearance | appearance | `appearance.language` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.language` |
| `HSET-108` | Appearance | appearance | `appearance.introSplash` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.introSplash` |
| `HSET-109` | Appearance | appearance | `appearance.modelPricing` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.modelPricing` |
| `HSET-110` | Appearance | appearance | `appearance.resumeLastSession` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.resumeLastSession` |
| `HSET-111` | Appearance | appearance | `appearance.tips` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.tips` |
| `HSET-112` | Appearance | appearance | `appearance.tours` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.tours` |
| `HSET-113` | Appearance | appearance | `appearance.theme` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.theme` |
| `HSET-114` | Appearance | appearance | `appearance.uiScale` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.uiScale` |
| `HSET-115` | Appearance | appearance | `appearance.chatTextScale` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.chatTextScale` |
| `HSET-116` | Appearance | appearance | `appearance.chatFont` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.chatFont` |
| `HSET-117` | Appearance | appearance | `appearance.terminalFont` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.terminalFont` |
| `HSET-118` | Appearance | appearance | `appearance.interfaceMode` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.interfaceMode` |
| `HSET-119` | Appearance | appearance | `appearance.sessionDensity` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.sessionDensity` |
| `HSET-120` | Appearance | appearance | `appearance.tabStrip` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.tabStrip` |
| `HSET-121` | Appearance | appearance | `appearance.appActions` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.appActions` |
| `HSET-122` | Appearance | appearance | `appearance.minimizeToTray` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.minimizeToTray` |
| `HSET-123` | Appearance | appearance | `appearance.translucency` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.translucency` |
| `HSET-124` | Appearance | appearance | `appearance.backdrop` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.backdrop` |
| `HSET-125` | Appearance | appearance | `appearance.fileBrowser` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.fileBrowser` |
| `HSET-126` | Appearance | appearance | `appearance.composerPopout` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.composerPopout` |
| `HSET-127` | Appearance | appearance | `appearance.userBubble` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.userBubble` |
| `HSET-128` | Appearance | appearance | `appearance.textDirection` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.textDirection` |
| `HSET-129` | Appearance | appearance | `appearance.hideThreadTimeline` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.hideThreadTimeline` |
| `HSET-130` | Appearance | appearance | `appearance.reactions` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.reactions` |
| `HSET-131` | Appearance | appearance | `appearance.vibeHearts` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.vibeHearts` |
| `HSET-132` | Appearance | appearance | `appearance.toolView` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.toolView` |
| `HSET-133` | Appearance | appearance | `appearance.hideCodeDiffs` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.hideCodeDiffs` |
| `HSET-134` | Appearance | appearance | `appearance.reasoningCollapsed` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.reasoningCollapsed` |
| `HSET-135` | Appearance | appearance | `appearance.embeds` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.embeds` |
| `HSET-136` | Appearance | appearance | `appearance.pet` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#appearance.pet` |
| `HSET-137` | Chat | chat | `chat.attachmentSize` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#chat.attachmentSize` |
| `HSET-138` | Advanced | advanced | `advanced.keepAwake` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#advanced.keepAwake` |
| `HSET-139` | Advanced | advanced | `advanced.disableF12` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#advanced.disableF12` |
| `HSET-140` | Advanced | advanced | `advanced.quickEntry` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#advanced.quickEntry` |
| `HSET-141` | Advanced | advanced | `advanced.quickEntryShortcut` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#advanced.quickEntryShortcut` |
| `HSET-142` | Keybinds | keybinds | `keybinds.hudModifier` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#keybinds.hudModifier` |
| `HSET-143` | Keybinds | keybinds | `keybinds.screenshot` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#keybinds.screenshot` |
| `HSET-144` | Notifications | notifications | `notifications.enableAll` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#notifications.enableAll` |
| `HSET-145` | Notifications | notifications | `notifications.browserPermission` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#notifications.browserPermission` |
| `HSET-146` | Notifications | notifications | `notifications.muteSounds` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#notifications.muteSounds` |
| `HSET-147` | Notifications | notifications | `notifications.completionSound` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#notifications.completionSound` |
| `HSET-148` | Sessions | sessions | `sessions.autoArchive` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#sessions.autoArchive` |
| `HSET-149` | Gateway | gateway | `gateway.connectionMode` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#gateway.connectionMode` |
| `HSET-150` | Gateway | gateway | `gateway.keychainEncryption` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#gateway.keychainEncryption` |
| `HSET-151` | Gateway | gateway | `gateway.diagnostics` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#gateway.diagnostics` |
| `HSET-152` | About | about | `about.updates` | desktop_manifest | `apps/desktop/src/app/settings/settings-manifest.ts#about.updates` |
| `HSET-153` | Dedicated Views | providers | `view:providers` | dedicated_view | `apps/desktop/src/app/settings/types.ts#providers` |
| `HSET-154` | Dedicated Views | keys | `view:keys` | dedicated_view | `apps/desktop/src/app/settings/types.ts#keys` |
| `HSET-155` | Dedicated Views | connections | `view:connections` | dedicated_view | `apps/desktop/src/app/settings/types.ts#connections` |
| `HSET-156` | Dedicated Views | plugins | `view:plugins` | dedicated_view | `apps/desktop/src/app/settings/types.ts#plugins` |
| `HSET-157` | Dedicated Views | vault | `view:vault` | dedicated_view | `apps/desktop/src/app/settings/types.ts#vault` |
| `HSET-158` | Dedicated Views | backup | `view:backup` | dedicated_view | `apps/desktop/src/app/settings/types.ts#backup` |
| `HSET-159` | Dedicated Views | web-access | `view:web-access` | dedicated_view | `apps/desktop/src/app/settings/types.ts#web-access` |
| `HSET-160` | Dedicated Views | billing | `view:billing` | dedicated_view | `apps/desktop/src/app/settings/types.ts#billing` |
| `HSET-161` | Dedicated Views | about.uninstall | `view:about.uninstall` | dedicated_view | `apps/desktop/src/app/settings/types.ts#about.uninstall` |
