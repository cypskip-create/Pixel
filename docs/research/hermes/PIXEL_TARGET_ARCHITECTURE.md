# Pixel Target Architecture (Hermes-Inspired, Python-First Core + Electron/React UI)

## Architectural Split

```mermaid
flowchart TB
  subgraph UI["Renderer (React 19 + TypeScript, Sandboxed)"]
    WS["Workspace (Consolidated Sidebar, Chat + ASCII Sharks, Projects, Library, Pixel Board, Running Tasks, 11-Category Flat Settings)"]
    Island["Dynamic Island + Cursor Buddy + Visual Guidance Overlay"]
  end

  subgraph Main["Electron Main Process (TypeScript — Security & OS Authority)"]
    Preload["Preload CypsBridge (contextIsolation, sandbox, sender-checked)"]
    Broker["PermissionBroker & CONSEQUENCE_POLICY (Sole Execution Authority)"]
    Secrets["SettingsStore (Windows DPAPI safeStorage — Keys Never Written by Python)"]
    Native["PixelNative.exe (C# Semantic Windows UIA) + Playwright BrowserSession + PixelBoardService"]
    Bridge["PythonAgentBridge v2 (Ownership File + Crash Log + Streaming NDJSON + TS Rollback)"]
  end

  subgraph PyCore["Pixel Python Agent Runtime (python/ — Protocol pixel-agent-v2)"]
    Loop["Conversation Loop (IterationBudget, Repetition Guard, 80% Wrap-up)"]
    Comp["Context Compressor (Tool Prune -> Micro-compact -> Aux Summary)"]
    Providers["Provider Adapters (DeepSeek, Ollama, OpenAI-Compat, Anthropic)"]
    MemSkills["Selective Memory + Session FTS5 Search + SKILL.md Playbooks"]
    Sched["Cron Scheduler (croniter + tzdata) & Parallel Delegation"]
    Ext["Tier-1 Python Plugins + MCP Client (Stdio/Streamable HTTP + OSV Preflight)"]
  end

  WS <--> Preload
  Island <--> Preload
  Preload <--> Broker
  Broker <--> Native
  Broker <--> Bridge
  Secrets -.->|Ephemeral per-turn in-memory credential| Bridge
  Bridge <-->|NDJSON: turn.*, tool.request/response, task.step| Loop
  Loop --> Comp
  Loop --> Providers
  Loop --> MemSkills
  Loop --> Sched
  Loop --> Ext
```

## Non-Negotiable Invariants
1. **Single Authorization Authority:** Electron main's `PermissionBroker` remains the **only** authority that approves, denies, or executes privileged OS/file/Git/UIA/browser actions. Python emits `tool.request` frames and waits for `tool.response` — it never bypasses `PermissionBroker`.
2. **No Secret Leakage:** DPAPI credentials stay in Electron main (`SettingsStore`) and are passed in-memory per provider request or host-pinned adapter, never written to `.env`, logs, or renderer state.
3. **Preserve Pixel Identity:** Keep Pixel's near-black matte + blue (`#4299F5`) design system, 11-category flat Settings, Pix mascot, ASCII Shark background, Pixel Board, and C# `PixelNative.exe`.
4. **Always-Available Rollback:** Feature flag `agent.runtimeEngine: 'python' | 'typescript'` allows instant fallback to the existing TypeScript `AgentExecutor` if Python is unavailable or fails health checks.
