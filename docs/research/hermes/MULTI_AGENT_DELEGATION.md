# Multi-Agent Delegation Architecture

Source authority: `tools/delegate_tool.py`, `tools/delegate_tool_child_run.py`, `tools/delegate_tool_config.py`, `tools/delegate_tool_dispatch.py`, `tools/delegate_tool_registry.py`, `tools/delegate_tool_toolsets.py`, `tools/delegate_tool_results.py`.

## 1. How Hermes Delegation Works
- **Fresh Isolated Child `AIAgent`:** `delegate_task` spawns one or more child `AIAgent` instances (single or parallel `_Batch` mode) with:
  - Fresh conversation history (goal + context passed as first user turn; parent never sees child intermediate reasoning or tool calls — only the budgeted summary result via `_apply_summary_budget`).
  - Independent `task_id` (own terminal session & file-ops cache).
  - **Roles (`leaf` vs. `orchestrator`) & Depth Cap:** `_get_max_spawn_depth()` and `_get_max_concurrent_children()` bound fan-out. Nested delegation is granted ONLY by depth/role in `_build_child_agent`, never by the model naming toolsets.
  - **Tool Stripping (`DELEGATE_BLOCKED_TOOLS`):** Parent's toolsets are expanded and stripped of child-blocked tools (`_strip_blocked_tools`).
  - **Profile Home Pinning (`_parent_live_home`):** Resolves the live profile directory strictly from `parent_agent.persistence.scope.profile_dir` (concrete `str`/`Path` only) so child transcripts never leak into the default profile.
  - **Control & Heartbeats:** `_active_subagents` registry supports `list_active_subagents`, `steer_subagent`, `interrupt_subagent`, `set_spawn_paused`, `_Heartbeat`, structured output schema validation (`_validate_child_output_schema`), and timeout diagnostics (`_dump_subagent_timeout_diagnostic`).

## 2. Mapping to Pixel's `SpecialistCoordinator` (`src/main/agents/coordinator.ts`)
- **What Pixel already has:** 4 bounded specialist profiles (`research`, `browser`, `systems`, `knowledge`) wired into `AgentExecutor` via `delegate_to_specialist`, strictly routed through Pixel's central `PermissionBroker` with no nested delegation and no Pixel Code access.
- **Gaps to close in Phase E:**
  1. Parallel batch delegation (`Promise.allSettled` / Python `ThreadPoolExecutor`) with configurable concurrency ceiling (e.g. max 3 children).
  2. Parent-to-child cancellation propagation (`AbortController` / cancel token) + child progress heartbeats visible in Running Tasks.
  3. Optional JSON schema validation on child summary results and strict summary token budgets.
