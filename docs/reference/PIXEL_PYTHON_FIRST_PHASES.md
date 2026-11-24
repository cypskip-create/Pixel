# Pixel — Python-First Phased Implementation Blueprint (Master Memory)

> **Usage:** Whenever the user says **"implement Phase N"** (e.g. `"implement Phase 1"`), read the corresponding phase section below, inspect the referenced Hermes source files (`C:\dev\pixel-research\hermes-agent`, commit `352b249f67fb6a4a7d7904acaca9dd410db229e0`), implement the Python-first modules and thin Electron/TS wiring, run all tests (`check:scope`, `typecheck`, Python `unittest`, Vitest, `npm run build`), and push + verify Windows CI.

## Architectural Rules (Permanent)

1. **Python First:** All intelligence, agent loop, memory, context compression, prompt building, delegation, tools, approval analysis, plugins, MCP, gateway, cron intelligence, and multimodal/voice orchestration live in `python/pixel_agent/`.
2. **TypeScript Frontend & Trusted OS Shell:** React/TypeScript (`src/renderer/`) handles UI; Electron main (`src/main/`) handles OS permissions (`PermissionBroker`), DPAPI credentials, windowing, SQLite/filesystem security boundaries, and thin IPC bridging to Python.
3. **C# Native Helper:** `native/` handles Windows UI Automation and OS-level desktop input/screen helpers.
4. **No Bulk Imports:** Never copy Hermes folders into Pixel (`npm run check:scope` must always pass).

---

## Phase 1 — Python Prompt Builder, Context Engine & Auxiliary Model Client
- **Hermes Reference:** `agent/prompt_builder.py`, `agent/prompt_cache_boundary.py`, `agent/system_prompt.py`, `agent/context_compressor*.py`, `agent/context_pin.py`, `agent/context_breakdown.py`, `agent/auxiliary_client.py`, `agent/anthropic_thinking_replay.py`, `agent/plan_prompt.py`
- **Python Target (`python/pixel_agent/`):**
  - `prompt_builder.py`: Deterministic prompt assembly (`SOUL.md`, active profile instructions, frozen memory snapshot, skill index, cache-boundary marker) + Plan/Learn mode prompt modes.
  - `context_engine.py`: Upgrade `compressor.py` with context breakdown telemetry (tokens by system/memory/tools/history), pinned context files (`context_pin`), and durable compression summaries.
  - `auxiliary.py`: Lightweight auxiliary model client for cheap background tasks (compression summaries, title generation, memory extraction) with fallback to primary model.
  - `providers.py`: Add Anthropic extended-thinking block replay (`anthropic_thinking_replay`) and SSE stream hardening.
- **TS/IPC Touchpoints:** Expose `context.breakdown` & `context.pin` RPCs; wire `PromptBuilder` into `protocol.py` (`turn.start` & `_dispatch_gateway_turn`).
- **Acceptance Tests:** Python unit tests for cache-stable prompt prefixes, pinned context survival across 2-stage compression, context breakdown token accounting, auxiliary client routing, and Anthropic thinking replay.

## Phase 2 — Python-First Memory Engine, FTS5 Session Search & Procedural Skills (`SKILL.md`)
- **Hermes Reference:** `agent/memory_manager.py`, `agent/memory_provider.py`, `agent/memory_context.py`, `agent/memory_caller_scope.py`, `tools/memory_tool*.py`, `tools/session_search_tool.py`, `tools/skills_tool*.py`, `tools/skill_manager_tool.py`
- **Python Target (`python/pixel_agent/memory/`):**
  - `store.py`: Authoritative Python SQLite memory store with profile/project isolation, credential-pattern rejection, revision history, and frozen session snapshots (`memory_char_limit`, `user_char_limit`).
  - `session_search.py`: Python SQLite FTS5 full-text session search with secret redaction and profile/project scoping.
  - `skills_engine.py`: Procedural `SKILL.md` parser, threat scanner, deduplicator, index prompt builder, and agent-callable `skill_manage` / `skills_list` / `skill_view` tools.
- **TS/IPC Touchpoints:** Bridge memory/session_search/skills RPCs through `PythonAgentBridge` while preserving backward compatibility with existing SQLite data.
- **Acceptance Tests:** Cross-profile memory isolation, frozen snapshot immutability during a session, credential rejection, FTS5 search redaction, and `SKILL.md` threat-scan blocking.

## Phase 3 — Python Agentic Modes, Async Resumable Delegation & Interactive Tools (`clarify`, `todo`, `code_execution`)
- **Hermes Reference:** `tools/delegate_tool*.py`, `tools/async_delegation*.py`, `agent/delegation_context.py`, `tools/clarify_tool.py`, `tools/todo_tool.py`, `tools/code_execution_tool.py`
- **Python Target (`python/pixel_agent/delegation/` & `python/pixel_agent/tools/`):**
  - `delegation/orchestrator.py`: Python-native sync & **async background subagent orchestrator** with per-child toolset scoping, concurrency cap (3), progress streaming, resumable child sessions (`continue`), abort propagation, and recovery hints.
  - `tools/todo.py`: Persistent per-session structured task/checklist tool (`todo_write`, `todo_read`).
  - `tools/clarify.py`: Structured multi-choice / freeform user clarification tool pausing the turn cleanly until user responds.
  - `tools/code_exec.py`: Bounded, timeout-enforced, minimal-env Python/script execution tool (gated by Electron `PermissionBroker`).
- **TS/IPC Touchpoints:** Stream child delegation progress events into `AgentsPage` & `WorkspaceTasks`; render interactive `clarify` cards and live `todo` lists in chat.
- **Acceptance Tests:** Parallel async child agents with parent abort propagation, resumable child continuation, `todo` persistence, `clarify` pause/resume, and `code_exec` timeout/env isolation.

## Phase 4 — Python Security Approval Analyzer, Toolsets Catalog & Safe File/Web Tools
- **Hermes Reference:** `tools/approval*.py` (`approval_detection.py`, `approval_shell_tokens.py`, `approval_windows_hardline.py`, `approval_provenance.py`), `toolsets.py`, `toolset_distributions.py`, `tools/arg_coercion.py`, `tools/web_tools*.py`, `tools/file_tools_read_tracking.py`
- **Python Target (`python/pixel_agent/security/` & `python/pixel_agent/tools/`):**
  - `security/approval_analyzer.py`: Deep shell-token & Windows hardline command analyzer (detects pipe launchers, env-split, quoted newlines, WMIC/PowerShell obfuscation, credential exfiltration) returning structured risk classifications to Electron `PermissionBroker`.
  - `toolsets.py`: Full Hermes toolset & distribution catalog (`coding`, `research`, `browser`, `desktop`, `messaging`, `automation`, `full`) with arg coercion/validation.
  - `tools/web_extract.py`: Python web fetch/extract/truncate/rescue pipeline with IMDS/private-IP blocking.
- **TS/IPC Touchpoints:** Invoke Python risk analysis before terminal/process approvals; expose toolset distributions in Capabilities UI.
- **Acceptance Tests:** Dangerous Windows/POSIX shell obfuscation test matrix, arg coercion tests, IMDS/SSRF blocking, and toolset filtering tests.

## Phase 5 — Python Plugin Platform Extensions, MCP Health/Sampling & Connectors
- **Hermes Reference:** `plugins/plugin_loader.py`, `plugins/plugin_storage.py`, `tools/mcp_tool_health.py`, `tools/mcp_tool_sampling.py`, `tools/mcp_tool_lifecycle.py`, `tools/connectors/`
- **Python Target (`python/pixel_agent/`):**
  - `plugin_storage.py`: Sandboxed per-plugin key-value/file storage API inside `plugin_sdk.py`.
  - `mcp_client.py`: Add periodic health checks, auto-reconnect with backoff, and MCP sampling support.
  - Pluggable category hooks for `memory`, `browser`, `model-providers`, and `cron_providers` plugins.
- **TS/IPC Touchpoints:** Surface MCP server health badges & reconnect controls in `WorkspacePluginManager` / Capabilities.
- **Acceptance Tests:** Plugin storage isolation, MCP crash-and-auto-reconnect test, MCP sampling roundtrip.

## Phase 6 — Full Bidirectional Messaging Adapters & Webhook Coalescing
- **Hermes Reference:** `gateway/platforms/`, `gateway/platforms/webhook_coalesce.py`, `gateway/platforms/api_server*.py`, `gateway/bot_loop_guard.py`
- **Python Target (`python/pixel_agent/gateway/`):**
  - Upgrade **Matrix** with background `/_matrix/client/v3/sync` long-polling worker + persisted `next_batch` token → promote to `full_adapter`.
  - Upgrade **Email** with stdlib `imaplib` IMAP4_SSL background polling worker + UID offset persistence → promote to `full_adapter`.
  - Upgrade **Discord** with Gateway WebSocket / Interactions webhook ingress + Ed25519 signature verification → promote to `full_adapter`.
  - Add **Webhook Coalescing** (`webhook_coalesce.py`), **Bot Loop Guard** (`bot_loop_guard.py`), and SSE streaming on loopback `/v1/chat`.
- **TS/IPC Touchpoints:** Update `DedicatedMessagingPage` with IMAP/Matrix sync polling controls and live inbound status.
- **Acceptance Tests:** Mocked Matrix `/sync`, mocked IMAP polling, Discord signature verification, webhook coalescing window, and bot-loop breaker tests.

## Phase 7 — Python-Callable Cron Tools, Delivery Routing & Automation Blueprints
- **Hermes Reference:** `tools/cronjob_tools.py`, `cron/blueprint_catalog.py`, `cron/delivery_queue.py`, `cron/prompt_scan.py`, `web/src/components/AutomationBlueprints.tsx`
- **Python Target (`python/pixel_agent/cron_tools.py`):**
  - Agent-callable `cronjob` tool (`create`, `list`, `pause`, `resume`, `run_now`, `delete`) bridged to Pixel's canonical SQLite `RoutineStore`/`LocalRoutineScheduler` (zero duplicate schedulers!).
  - Prompt security scan (`prompt_scan.py`) on scheduled prompts + delivery target routing (send routine outputs to Desktop notification, Telegram, or Slack via `GatewayService`).
  - Curated `AutomationBlueprints` templates in `CronPage`.
- **Acceptance Tests:** Agent creating/running/pausing a routine via `cronjob` tool, prompt-injection rejection, and routine output delivery to mocked Gateway adapter.

## Phase 8 — Python Voice & Multimodal Pipeline Consolidation
- **Hermes Reference:** `tools/transcription_tools.py`, `tools/tts_tool*.py`, `tools/vision_tools*.py`, `tools/image_generation_tool.py`, `tools/video_generation_tool.py`
- **Python Target (`python/pixel_agent/multimodal.py`, `python/pixel_agent/voice.py`):**
  - Consolidate multi-provider STT/TTS routing, local Whisper/ONNX management, vision image prep/resizing, image generation, and video generation adapters in Python with automatic Artifact registration.
- **Acceptance Tests:** Python STT/TTS routing & privacy tests, image prep/budget tests, mocked image/video artifact registration.

---

## Phase 9 — Reverse Engineer Hiclicky (Screen-Drawing & On-Screen Annotation) via REA
- **Target:** User-supplied Hiclicky / HeyClacky binary, installer, or unpacked app (pointed to with **REA MCP** `open_binary` / `inspect_artifact` / `analyze_javascript_application` / native inspection).
- **Objectives:**
  1. Extract Hiclicky's transparent click-through overlay architecture, screen-drawing canvas (pen, arrows, highlights, callouts, fade/clear animations), global hotkeys, multi-monitor DPI handling, and Windows click-through (`WS_EX_TRANSPARENT` / `WS_EX_LAYERED`) mechanics.
  2. Write `docs/reference/HICLICKY_SCREEN_DRAWING_REFERENCE.md`.
  3. Implement the extracted screen-drawing & live annotation subsystem cleanly into Pixel's overlay + Python visual-guidance tools (replacing/upgrading `screen_highlight_control` & `screen_draw_arrow` with full live screen drawing!).

## Phase 10 — Pixel Desktop Visual Redesign (Paper MCP + Mobbin + TypeScript Frontend)
- **Design Tools:** Connected **Paper MCP (`paper`)** + **Mobbin (`mobbin_mobbin`)** + user's web design references.
- **Objectives:**
  1. Research best-in-class desktop AI companion & command-center patterns via Mobbin (`search_screens`, `search_flows`).
  2. Design Pixel's unified desktop shell, chat workspace, floating companion overlay, screen-drawing toolbar, and Stage 9 destinations in **Paper MCP** (`create_artboard`, `write_html`, `get_screenshot` visual review).
  3. Implement the approved Paper design cleanly in Pixel's React/TypeScript frontend (`src/renderer/`) with full 1440×900 visual parity verification.
