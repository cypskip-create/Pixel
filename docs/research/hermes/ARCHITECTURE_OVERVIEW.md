# Hermes Agent Architecture Overview

Based on `NousResearch/hermes-agent@0f602c5f`.

## High-Level System Architecture

Hermes separates **UI surfaces** (Electron Desktop, TypeScript TUI, CLI, Messaging Platforms) from a **Python-first core agent engine** coordinated through local gateways and a unified persistence layer.

```mermaid
flowchart TB
  subgraph Surfaces["Client Surfaces (TypeScript / CLI / Messaging)"]
    Desktop["Electron Desktop (apps/desktop, React + TS)"]
    TUI["Terminal UI (ui-tui, TS/React)"]
    CLI["CLI (cli.py, prompt_toolkit)"]
    Platforms["Messaging Gateway (gateway/, Telegram/Discord/Matrix/etc.)"]
  end

  subgraph Transport["Local Gateway & RPC Layer"]
    TuiGW["tui_gateway/server.py (JSON-RPC / Stdio / WS + Session Tickets)"]
    Cron["cron/scheduler.py (60s tick + file lock + delivery queue)"]
  end

  subgraph Core["Python Core Agent Engine"]
    Agent["run_agent.py (AIAgent + Mixins)"]
    Loop["agent/conversation_loop.py (Turn Phases + IterationBudget)"]
    Prompt["agent/prompt_builder.py (System Prompt + Threat Scan)"]
    Comp["agent/context_compressor.py (Prune -> Micro-compact -> Aux Summary)"]
    Mem["agent/memory_manager.py + tools/memory_tool.py (MEMORY.md / USER.md)"]
  end

  subgraph Execution["Tools, Plugins & Safety"]
    Reg["tools/registry.py + model_tools.py + toolsets.py"]
    Approval["tools/approval.py (Hardline / Smart / Human Gate + Denial Breaker)"]
    Plugins["hermes_cli/plugins.py (Bundled / User / Project / Entrypoints)"]
    MCP["tools/mcp_tool.py (Stdio / Streamable HTTP / OSV Preflight)"]
    Delegate["tools/delegate_tool.py (Child AIAgent Subagents)"]
  end

  subgraph Storage["Persistence & State"]
    DB["persistence/ (SQLite WAL + Read Pool + Writer Mutex + FTS5)"]
    Files["~/.hermes/ (config.yaml, memories/, skills/, cron/)"]
  end

  Desktop -->|Ticketed Local HTTP/WS| TuiGW
  TUI -->|JSON-RPC| TuiGW
  CLI --> Agent
  Platforms --> Agent
  Cron --> Agent
  TuiGW --> Agent
  Agent --> Loop
  Loop --> Prompt
  Loop --> Comp
  Loop --> Mem
  Loop --> Reg
  Reg --> Approval
  Reg --> Plugins
  Reg --> MCP
  Reg --> Delegate
  Agent --> DB
  Mem --> Files
  Cron --> DB
```

## Core Architectural Principles Observed

1. **Mixin-Composed Agent Core:** `AIAgent` in `run_agent.py` stays navigable by delegating lifecycle, streaming, compression, persistence, interrupts, and turn phases to focused modules under `agent/`.
2. **Self-Registering Tool Registry with Scope Overlays:** `tools/registry.py` avoids circular imports and supports `ContextVar`-scoped session tool overlays and AST-cached discovery.
3. **Frozen Session Memory Snapshot for Prefix-Cache Stability:** `MEMORY.md` and `USER.md` enter the system prompt as a frozen snapshot at session start; mid-session writes persist to disk without mutating the prompt prefix cache.
4. **Fail-Closed Safety & Quarantine:** Corrupt SQLite stores quarantine rather than silently resetting; corrupt Electron backend ownership files quarantine rather than leaking orphan processes; explicitly empty toolset allowlists fail closed.
5. **Independent Local Gateway Ownership:** Electron Desktop connects to an independently owned local gateway via minted per-request `X-Hermes-Gateway-Ticket` grants rather than stuffing credentials into renderer state or URLs.
