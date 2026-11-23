# Hermes Complete Feature Integration Matrix

**Reference Commit:** `352b249f67fb6a4a7d7904acaca9dd410db229e0` (`C:\dev\pixel-research\hermes-agent`)

| Domain | Hermes Capability | Pixel Target | Status | Test Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **Agent Runtime** | Streaming tool loop, budgets, repetition guard, 2-stage compression (`enabled`, `threshold`, `protect_last_n`), `maxTurns`, `apiMaxRetries` | `python/pixel_agent/`, `src/main/agent/` | **Implemented and tested** | `tests/python-agent-parity.test.ts`, `tests/hermes-stage1-runtime-display-parity.test.ts` |
| **Delegation** | Parallel child specialists (cap 3), configurable `maxIterations` & `childTimeoutSec`, abort propagation, heartbeats | `src/main/agents/coordinator.ts` | **Implemented and tested** | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts`, `tests/hermes-stage1-runtime-display-parity.test.ts` |
| **Memory & Skills** | Frozen session snapshots with configurable `memoryCharLimit` & `userProfileCharLimit`, FTS5 `session_search`, `SKILL.md` playbooks + threat scanner | `src/main/memory/`, `src/main/history/sessionSearch.ts`, `src/main/skills/procedural.ts` | **Implemented and tested** | `tests/phase-c-memory-skills.test.ts`, `tests/hermes-stage1-runtime-display-parity.test.ts` |
| **Scheduling & Recovery** | 5-field IANA/DST cron, SQLite transactional lease locking, missed-run policies, fail-closed crash recovery | `src/main/routines/`, `src/main/tasks/recovery.ts` | **Implemented and tested** | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts` |
| **Plugins & MCP** | Stdio + Streamable HTTP MCP client, OSV preflight, OAuth 2.0 PKCE, Google Calendar, GitHub PAT | `src/main/plugins/`, `python/pixel_agent/mcp_client.py` | **Implemented and tested** | `tests/phase-d-mcp-plugins.test.ts`, `python/tests/test_mcp_client.py` |
| **Display & Settings** | UI scale, chat text scale, sidebar density, reasoning collapse, hide code diffs, mute sounds, default timezone | `src/renderer/Workspace.tsx`, `SettingsPanel.tsx` | **Implemented and tested** | `tests/hermes-stage1-runtime-display-parity.test.ts` |
| **Multi-Provider & Fallbacks** | OpenRouter, Anthropic, OpenAI, Gemini, xAI, custom endpoints, fallback chains | `src/main/providers/`, `python/pixel_agent/providers.py` | **Missing (Stage 2)** | — |
| **Workspace Shell Extensions** | Session tabs, split panes, command palette, right-side file browser, integrated terminal | `src/renderer/Workspace.tsx` | **Missing (Stage 3)** | — |
| **Gateway & Messaging** | Remote gateway connections, Discord/Telegram/Slack/Matrix messaging adapters | `src/main/` | **Missing (Stage 8)** | — |
