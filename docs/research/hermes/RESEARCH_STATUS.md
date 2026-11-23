# Phase H1 Research Coverage & Status Ledger

Updated: 2026-11-23 | Pinned Hermes Revision: `0f602c5f6f18615632535251d62a2db74ce93b69`

| Pass | Scope | Method | Status | Key Artifacts |
| --- | --- | --- | --- | --- |
| **Pass 1** | REA verification & full repo inventory | REA MCP + `git ls-files` + Python AST | **Complete** | `SOURCE_INVENTORY.md`, `REA_EVIDENCE_INDEX.md`, `TOOL_INVENTORY.json` |
| **Pass 2** | Core Python agent runtime & providers | Direct source inspection (`run_agent.py`, `agent/conversation_loop.py`, `agent/prompt_builder.py`, `agent/context_compressor.py`) | **Complete** | `AGENT_RUNTIME.md`, `MODEL_PROVIDERS.md` |
| **Pass 3** | Tool registry, toolsets & execution backends | Python AST scan + direct inspection (`tools/registry.py`, `model_tools.py`, `toolsets.py`, `tools/terminal_tool.py`, `tools/mcp_tool.py`) | **Complete** | `TOOLS_AND_TOOLSETS.md`, `TOOL_INVENTORY.json` |
| **Pass 4** | Memory & context compression | Direct inspection (`tools/memory_tool.py`, `agent/memory_manager.py`, `agent/memory_provider.py`, `agent/context_compressor.py`) | **Complete** | `MEMORY_SYSTEM.md`, `SESSIONS_AND_CONTEXT.md` |
| **Pass 5** | Plugins & skills | Direct inspection (`hermes_cli/plugins.py`, `tools/skill_manager_tool.py`, `tools/mcp_tool.py`) | **Complete** | `PLUGIN_ARCHITECTURE.md`, `SKILLS_AND_LEARNING.md` |
| **Pass 6** | Sessions, cron & gateway | Direct inspection (`hermes_state.py`, `cron/scheduler.py`, `tui_gateway/server.py`, `canonical-gateway-protocol.md`) | **Complete** | `SESSIONS_AND_CONTEXT.md`, `BACKGROUND_EXECUTION.md` |
| **Pass 7** | Delegation & security | Direct inspection (`tools/delegate_tool.py`, `tools/approval.py`, `tools/threat_patterns.py`) | **Complete** | `MULTI_AGENT_DELEGATION.md`, `SECURITY_AND_PERMISSIONS.md` |
| **Pass 8** | Hermes Desktop (Electron/React/Python) | **REA MCP `analyze_javascript_application`** (bounded electron & renderer slices) + `DESIGN.md`, `backend-ownership.ts`, `package.json` | **Complete** | `DESKTOP_ARCHITECTURE.md`, `REA_EVIDENCE_INDEX.md` |
| **Pass 9** | Tests, languages & dependencies | `git ls-files` breakdown + `pyproject.toml` + `apps/desktop/package.json` | **Complete** | `LANGUAGE_AND_DEPENDENCIES.md`, `TESTING_AND_VALIDATION.md` |
| **Pass 10** | Hermes vs Pixel comparison & blueprint | Cross-checked against Pixel `src/main/`, `src/renderer/`, `python/agent_service.py` | **Complete** | `HERMES_VS_PIXEL.md`, `PIXEL_TARGET_ARCHITECTURE.md`, `PIXEL_MIGRATION_PLAN.md`, `IMPLEMENTATION_CHECKLIST.md` |

## Explicit Limitations & Open Questions

1. **No live execution of Hermes tests:** Hermes pins `requires-python = ">=3.11,<3.15"` (CPython 3.14 wheels) while this host has Python `3.15.2`; no Hermes runtime packages were installed to avoid altering the host environment.
2. **Bounded REA scope:** Full-directory REA analysis on `apps/desktop/electron` (750 files) timed out at 180s; bounded `source_paths` calls on key transport/ownership/entry files succeeded cleanly with 0 parse failures and explicit `unselected_files` accounting.
3. **Table-driven/plugin tool names:** Static AST scan extracted 50 `registry.register(...)` call sites (48 unique entries, including 3 dynamic loop expressions such as `kanban_*` and `feishu_*` documented in `TOOLS_AND_TOOLSETS.md`).
4. **Windows packaging choice for Pixel Python runtime:** Whether Phase A ships an embedded CPython 3.12/3.14 zip vs. `uv`-managed venv vs. PyInstaller bundle needs a final size/antivirus decision during Phase A kickoff.
