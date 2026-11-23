# Hermes Agent Reverse-Engineering Knowledge Base (Phase H1)

- **Upstream Repository:** `https://github.com/NousResearch/hermes-agent`
- **Pinned Commit SHA:** `0f602c5f6f18615632535251d62a2db74ce93b69` (branch `main`, clean)
- **License:** MIT License (Copyright (c) 2025 Nous Research)
- **Local Research Clone:** `C:\dev\pixel-research\hermes-agent` (outside Pixel production source)
- **REA Version:** `6.10.1` (Antigravity MCP server `rea`, skill `reverse-engineer-anything` v63)
- **Host Environment:** Windows x64, Node `v26.13.0`, Python `3.15.2`
- **Destination Project:** Pixel (`https://github.com/cypskip-create/Pixel`)

> **Phase H1 Scope Rule:** Research and architectural blueprint only. No Pixel production code was modified in Phase H1.

## Document Index

| Document | Focus |
| --- | --- |
| [RESEARCH_STATUS.md](./RESEARCH_STATUS.md) | Pass-by-pass coverage ledger & open questions |
| [SOURCE_INVENTORY.md](./SOURCE_INVENTORY.md) | Complete 27,462-file subsystem & language index |
| [REA_EVIDENCE_INDEX.md](./REA_EVIDENCE_INDEX.md) | Verified REA MCP Evidence IDs, scopes, and limitations |
| [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md) | End-to-end Hermes system architecture |
| [AGENT_RUNTIME.md](./AGENT_RUNTIME.md) | `run_agent.py`, `conversation_loop.py`, turn lifecycle, planning |
| [MODEL_PROVIDERS.md](./MODEL_PROVIDERS.md) | Multi-provider adapters, streaming, fallbacks, token budgets |
| [TOOLS_AND_TOOLSETS.md](./TOOLS_AND_TOOLSETS.md) | Tool registry, toolsets, execution backends, and gap analysis |
| [TOOL_INVENTORY.json](./TOOL_INVENTORY.json) | Machine-readable AST inventory of registered Hermes tools |
| [MEMORY_SYSTEM.md](./MEMORY_SYSTEM.md) | `MEMORY.md`/`USER.md`, `MemoryManager`, providers, selective memory |
| [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) | `hermes_cli/plugins.py`, manifests, hooks, MCP, trust boundaries |
| [SKILLS_AND_LEARNING.md](./SKILLS_AND_LEARNING.md) | `SKILL.md`, `skill_manager_tool.py`, security scans, self-improvement |
| [SESSIONS_AND_CONTEXT.md](./SESSIONS_AND_CONTEXT.md) | `persistence/`, SQLite/WAL, FTS5 search, `context_compressor.py` |
| [BACKGROUND_EXECUTION.md](./BACKGROUND_EXECUTION.md) | `cron/scheduler.py`, `gateway/`, `tui_gateway/`, restart recovery |
| [MULTI_AGENT_DELEGATION.md](./MULTI_AGENT_DELEGATION.md) | `tools/delegate_tool.py`, child isolation, orchestration, budgets |
| [DESKTOP_ARCHITECTURE.md](./DESKTOP_ARCHITECTURE.md) | `apps/desktop/` Electron/React/Python gateway transport & ownership |
| [SECURITY_AND_PERMISSIONS.md](./SECURITY_AND_PERMISSIONS.md) | `tools/approval.py`, denial breaker, threat scanning, Pixel matrix |
| [LANGUAGE_AND_DEPENDENCIES.md](./LANGUAGE_AND_DEPENDENCIES.md) | Python vs TypeScript distribution, pinned deps, supply-chain hardening |
| [TESTING_AND_VALIDATION.md](./TESTING_AND_VALIDATION.md) | 9,389 Python tests, Vitest/Playwright desktop tests, Pixel test matrix |
| [HERMES_VS_PIXEL.md](./HERMES_VS_PIXEL.md) | Subsystem-by-subsystem Hermes vs. Pixel capability comparison |
| [PIXEL_TARGET_ARCHITECTURE.md](./PIXEL_TARGET_ARCHITECTURE.md) | Target Python-first agent + Electron/React UI architecture for Pixel |
| [PIXEL_MIGRATION_PLAN.md](./PIXEL_MIGRATION_PLAN.md) | Phased A–G implementation blueprint with protocols, migrations & rollback |
| [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md) | Actionable Phase A–G engineering checklist |
