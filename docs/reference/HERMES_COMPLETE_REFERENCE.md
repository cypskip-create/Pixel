# Hermes Agent — Complete Technical Reference for Pixel (Python-First)

**Pinned Hermes Reference:** `NousResearch/hermes-agent` @ `352b249f67fb6a4a7d7904acaca9dd410db229e0` (`C:\dev\pixel-research\hermes-agent`)  
**Target Architecture:** **Python** for all agent runtime, memory, tools, plugins, delegation, scheduling, gateway, voice, multimodal, and backend services; **TypeScript/React** strictly for Electron shell, trusted OS/IPC boundaries, and desktop presentation; **C#** for Windows native UI Automation.  
**Policy:** Extract algorithms, contracts, and modular designs into Pixel's `python/pixel_agent/` packages — never bulk-copy Hermes trees (`scripts/check-no-bulk-import.mjs`).

---

## 1. Core Agent Loop, Prompting & Context Engine (`run_agent.py`, `agent/`)

| Hermes Subsystem | Key Reference Files | Core Responsibilities & Invariants | Current Pixel Status |
| :--- | :--- | :--- | :--- |
| **Agent Loop & Turn Engine** | `run_agent.py`, `agent/agent_init*.py`, `agent/agent_runtime_helpers*.py`, `agent/turn_context.py`, `agent/activity_tracking.py` | Streaming multi-turn tool loop, iteration/wall-clock/tool-call budgets, repetition guard, mid-stream cancellation, dead-connection recovery, tool-call/result pairing invariants. | **Core in Python** (`python/pixel_agent/loop.py`, `budgets.py`, `protocol.py`). Missing: plan mode (`plan_prompt.py`), learn mode (`learn_prompt.py`), clarify tool loop, durable turn checkpoints. |
| **Prompt Builder & Caching** | `agent/system_prompt.py`, `agent/prompt_builder.py`, `agent/prompt_cache_boundary.py`, `agent/prompt_caching.py`, `agent/prompt_refresh.py` | Deterministic system prompt assembly (`SOUL.md`, profile instructions, frozen memory snapshot, skill index, toolset rules), cache-boundary stability so prompt prefixes stay cacheable across turns. | **Partial in TS** (`src/main/agent/conversation.ts`). Needs full Python `PromptBuilder` with cache boundaries & `SOUL.md` support. |
| **Context Compression Engine** | `agent/context_compressor*.py`, `agent/context_engine.py`, `agent/context_pin.py`, `agent/context_breakdown.py`, `trajectory_compressor.py` | 2-stage compression (Stage 1: prune old tool outputs; Stage 2: summarize middle turns while keeping tool_call/result pairs intact), context breakdown telemetry, pinned context files (`context_pin.py`), durable compression records. | **Basic 2-stage in Python** (`python/pixel_agent/compressor.py`). Missing: context breakdown inspector, context pinning, durable compression summaries. |
| **State & Crash Recovery** | `hermes_state*.py`, `session_rescue.py`, `session_retention.py`, `hermes_startup_watchdog.py` | Loop guard, state registry, session rescue after unclean shutdown, bounded retention & storage limits (`storage_limits.py`). | **Basic** (`crash_log.py`, TS `tasks/recovery.ts`). Needs Python-native session state & rescue store. |

---

## 2. Memory, Knowledge & Session Search (`agent/memory_*.py`, `tools/memory_tool*.py`, `tools/session_search_tool.py`)

| Hermes Subsystem | Key Reference Files | Core Responsibilities & Invariants | Current Pixel Status |
| :--- | :--- | :--- | :--- |
| **Memory Manager & Provider** | `agent/memory_manager.py`, `agent/memory_provider.py`, `agent/memory_context.py`, `agent/memory_caller_scope.py`, `plugins/memory/` | Frozen session memory snapshots (configurable `memory_char_limit`, `user_char_limit`), caller/profile scoping, pluggable memory providers, contradiction/revision history, automatic durable extraction with credential rejection. | **Currently in TS** (`src/main/memory/`). Needs Python-first `python/pixel_agent/memory/` engine (SQLite + frozen snapshots + caller scope + memory tools). |
| **Session Search (FTS5)** | `tools/session_search_tool.py`, `session_rules/` | Full-text FTS5 search over persisted conversations with redaction, project/profile scoping, and bounded excerpt return. | **Currently in TS** (`src/main/history/sessionSearch.ts`). Move search/query intelligence into Python `memory/session_search.py`. |
| **Skills & Playbooks (`SKILL.md`)** | `tools/skills_tool*.py`, `tools/skill_manager_tool.py`, `skills/`, `optional-skills/` | Procedural `SKILL.md` discovery, index prompt generation, deduplication, security threat scanning, draft/activate/pin/delete lifecycle, learning skills from completed runs. | **Split TS/Python** (`src/main/skills/`, `plugin_manager.py`). Unify procedural skill indexing, scanning, and `skill_manage` in Python. |

---

## 3. Tools, Approvals & Toolsets (`tools/`, `toolsets.py`, `model_tools.py`)

| Hermes Subsystem | Key Reference Files | Core Responsibilities & Invariants | Current Pixel Status |
| :--- | :--- | :--- | :--- |
| **Approval & Command Guard** | `tools/approval*.py` (`approval.py`, `approval_detection.py`, `approval_shell_tokens.py`, `approval_windows_hardline.py`, `approval_provenance.py`, `approval_smart.py`, `approval_gateway_wait.py`) | Shell token parsing, Windows hardline dangerous-command detection, wrapper/pipe/env-split/quoted-newline inspection, provenance checks, human-wait & gateway approval routing, arg coercion & validation (`arg_coercion.py`, `arg_validation.py`). | **Currently in TS** (`src/main/agent/tools.ts`, `runtime.ts`). Port deep command-safety analyzer & arg validation to Python `security/approval_analyzer.py` (keeping Electron `PermissionBroker` as OS enforcement gate). |
| **Files, Patching & Code Execution** | `tools/file_tools*.py`, `tools/code_execution_tool.py`, `tools/project_tools.py`, `tools/todo_tool.py`, `tools/clarify_tool.py` | Path-jailed read/write/patch, read-tracking before write (`file_tools_read_tracking.py`), write guards, sandboxed Python/script execution (`code_execution_tool.py`), structured `todo` tracking, interactive `clarify` prompts. | **Files in TS** (`src/main/files/`). Missing in Python: `code_execution_tool`, `todo_tool`, `clarify_tool`, read-before-write tracking. |
| **Terminal & Background Processes** | `tools/terminal_tool*.py`, `tools/read_terminal_tool.py`, `tools/close_terminal_tool.py`, `tools/environments/` | Local PTY/shell, background process registry, output polling, resize/close, environment backends (local, Docker, SSH). | **Local in TS** (`src/main/services/terminalService.ts`). Needs Python process/environment abstraction + optional Docker/SSH backends. |
| **Browser & Web Research** | `tools/browser_tool*.py`, `tools/browser_cdp_tool.py`, `tools/browser_vault_tool.py`, `tools/web_tools*.py`, `plugins/browser/` | Playwright/CDP automation, URL/IMDS network guard, real profile attach, dialog handling, web extraction/truncation/rescue, pluggable cloud browsers (Browserbase, Firecrawl, Browser-Use). | **Local Playwright/CDP in TS** (`src/main/agent/browser.ts`). Needs Python web extraction/rescue (`web_tools`) & browser plugin hooks. |
| **Computer Use & Vision** | `tools/computer_use_tool.py`, `tools/computer_use/`, `tools/vision_tools*.py`, `tools/annotate_preview_tool.py`, `tools/image_generation_tool.py`, `tools/video_generation_tool.py` | Consolidated `computer_use`, Set-of-Marks (SoM) PNG annotation, vision capability guard, image history budget, image/video generation. | **SoM & vision guards in Python** (`multimodal.py`), Windows UIA in C# (`PixelNative.cs`). Needs Python `vision_tools` & video generation adapter. |
| **Delegation & Subagents** | `tools/delegate_tool*.py`, `tools/async_delegation*.py`, `agent/delegation_context.py`, `plugins/delegation/` | Synchronous + **async background delegation** (`async_delegation_worker.py`), resumable child agents (`delegate_tool_resumable.py`, `delegate_tool_continue.py`), per-child toolset scoping, progress streaming, auto-resume & recovery hints. | **Sync specialists in TS** (`src/main/agents/coordinator.ts`). Needs Python-first async/resumable subagent orchestrator (`python/pixel_agent/delegation/`). |
| **Voice & Audio** | `tools/transcription_tools.py`, `tools/tts_tool*.py`, `tools/wakewords/` | Multi-provider STT/TTS, local Whisper/ONNX, wake-word detection, barge-in, full-duplex GPT-Live. | **Local worker in Python** (`python/pixel_worker/`, `python/pixel_agent/voice.py`), cloud adapters in TS. Consolidate provider/routing logic into Python. |
| **Toolsets & Distributions** | `toolsets.py`, `toolset_distributions.py`, `model_tools.py` | Named toolsets (`coding`, `research`, `browser`, `desktop`, `messaging`, `full`), distribution bundles, per-profile & per-specialist toolset enforcement. | **Basic in Python** (`plugin_manager.py`). Needs full Hermes `toolsets.py` distribution catalog. |

---

## 4. Plugins, MCP & Connectors (`plugins/`, `tools/mcp_tool*.py`, `tools/connectors/`)

| Hermes Subsystem | Key Reference Files | Core Responsibilities & Invariants | Current Pixel Status |
| :--- | :--- | :--- | :--- |
| **Python Plugin Platform** | `plugins/plugin_loader.py`, `plugins/plugin_storage.py`, `plugins/plugin_utils.py`, `plugin-catalog/` | Manifest validation, isolated subprocess host, minimal allowlisted env, hook lifecycle, plugin storage, update/rollback, 19 plugin categories (browser, memory, platforms, image_gen, video_gen, cron_providers, model-providers, etc.). | **Strong foundation in Python** (`plugin_manifest.py`, `plugin_sdk.py`, `plugin_host.py`, `plugin_manager.py`). Needs plugin storage API + category extension points (memory/browser/model plugins). |
| **MCP Client & Sampling** | `tools/mcp_tool*.py`, `optional-mcps/` | Stdio + Streamable HTTP transports, OSV supply-chain preflight, health checks, lifecycle auto-restart, MCP sampling (`mcp_tool_sampling.py`), OAuth sessions, cost tracking, scoped tool exposure. | **Core in Python** (`mcp_client.py`, `osv_preflight.py`). Needs MCP health monitor, auto-reconnect, and sampling support. |
| **Kanban / Productivity / Connectors** | `tools/kanban_tools*.py`, `tools/connectors/`, `tools/drive_preview_tool.py` | Task boards, GitHub/Google Calendar/Drive connectors, preview tools (`open_preview_tool.py`, `read_preview_tool.py`). | **GitHub/GCal/Board in TS**. Expose unified Python connector interface. |

---

## 5. Multi-Provider Routing & Auxiliary Models (`providers/`, `agent/anthropic_*.py`, `agent/auxiliary_*.py`, `hermes_cli/fallback_config.py`)

| Hermes Subsystem | Key Reference Files | Core Responsibilities & Invariants | Current Pixel Status |
| :--- | :--- | :--- | :--- |
| **Provider Adapters & Fallbacks** | `providers/base.py`, `agent/anthropic_adapter.py`, `agent/anthropic_thinking_policy.py`, `agent/anthropic_thinking_replay.py`, `hermes_cli/fallback_config.py` | Native OpenAI-compat, native Anthropic (`/v1/messages` + thinking block replay), Gemini, DeepSeek, OpenRouter, xAI, Ollama, custom endpoints, ordered deduplicated fallback chains, per-profile overrides. | **Implemented in Python & TS** (`python/pixel_agent/providers.py`, `src/main/providers/`). Needs Python Anthropic thinking-block replay & auxiliary model client (`auxiliary_client.py` for cheap compression/memory/title calls). |

---

## 6. Gateway, Messaging Platforms, Webhooks & Remote API (`gateway/`)

| Hermes Subsystem | Key Reference Files | Core Responsibilities & Invariants | Current Pixel Status |
| :--- | :--- | :--- | :--- |
| **Gateway Runtime & Pairing** | `gateway/runtime`, `gateway/pairing.py`, `gateway/authz_mixin.py`, `gateway/delivery_ledger.py`, `gateway/bot_loop_guard.py`, `gateway/approval_actor.py` | Default-deny user pairing, device bearer tokens (SHA-256), per-scope tool filtering, delivery ledger with retries, bot-loop guard, approval actor+platform binding, Emergency Stop. | **Implemented in Python** (`python/pixel_agent/gateway/`). |
| **Messaging Platforms** | `gateway/platforms/`, `plugins/platforms/` | Telegram (`full_adapter`), Slack (`full_adapter` + HMAC verify), Discord (`partial` — needs WebSocket Gateway for live inbound), WhatsApp Cloud (`partial` — webhook ingress), Matrix (`partial` — needs `/sync` polling worker), Email (`outbound_only` — needs IMAP polling for full), + 20 extended platforms. | **Telegram & Slack full; Discord/WA/Matrix partial; Email outbound-only.** Upgrade Matrix `/sync`, Email IMAP, Discord Gateway, and webhook ingress in Python! |
| **Webhooks & Loopback HTTP API** | `gateway/platforms/webhook*.py`, `gateway/platforms/api_server*.py` | HMAC-SHA256 verification before rate-limit, route-scoped replay protection, webhook coalescing (`webhook_coalesce.py`), loopback `/v1/*` OpenAI-compatible API, device-isolated sessions. | **Implemented in Python** (`webhooks_and_api.py`). Needs webhook coalescing + SSE streaming on `/v1/chat`. |

---

## 7. Cron, Background Scheduler & Batch Execution (`cron/`, `batch_runner.py`)

| Hermes Subsystem | Key Reference Files | Core Responsibilities & Invariants | Current Pixel Status |
| :--- | :--- | :--- | :--- |
| **Cron Scheduler & Delivery** | `cron/scheduler*.py`, `cron/jobs*.py`, `cron/missed_runs.py`, `cron/delivery_queue.py`, `cron/blueprint_catalog.py`, `cron/prompt_scan.py` | 5-field IANA/DST cron, lease ownership, missed-run policies, run-now, delivery queue (send job results to Telegram/Slack/Desktop), automation blueprints, prompt security scan, agent-callable `cronjob` tool (`tools/cronjob_tools.py`). | **Canonical SQLite scheduler in TS** (`src/main/routines/`). Needs Python-callable `cronjob` tool, delivery target routing, and automation blueprints. |

---

## 8. Profiles, Security, ACL & Desktop Surfaces (`hermes_dir_acl.py`, `web/src/pages/`, `apps/desktop/`)

| Hermes Subsystem | Key Reference Files | Core Responsibilities & Invariants | Current Pixel Status |
| :--- | :--- | :--- | :--- |
| **Profiles & Isolation** | `web/src/pages/ProfilesPage.tsx`, `ProfileBuilderPage.tsx`, `hermes_scope.py`, `hermes_dir_acl.py` | Isolated profiles (history, memory, skills, tasks, artifacts, starmap, instructions, provider/model overrides), active-run switch guard, default profile protection. | **Implemented** (`workspace_services.py`, `stage9Helpers.ts`, `ipc.ts`). |
| **Desktop & Web Destinations** | `web/src/pages/*` (Command Center, Profiles, Agents, Artifacts, Cron, Starmap, Messaging, Webhooks, Session Import, Capabilities, Analytics, Logs) | Full-page destinations + Command Palette + split panes + right rail. | **Implemented functionally** (`Stage9Destinations.tsx`, `Workspace.tsx`). Ready for **Paper MCP / Mobbin** cohesive Pixel visual redesign! |
