# Pixel Multi-Phase Implementation Blueprint (Phases A–G)

Each phase below is self-contained, testable, and reversible. **Do not start Pixel Code during Phases A–G.**

---

## Phase A — Python Agent Engine (`pixel-agent-v2`)
- **Objective:** Upgrade `python/agent_service.py` from advisory-only `pixel-agent-v1` to a real streaming, tool-calling Python agent runtime with clean lifecycle and TS fallback.
- **Files to create/modify:**
  - `python/pyproject.toml` (exact-pinned core deps: `openai`, `httpx`, `pydantic`, `truststore`, `tzdata`, `croniter`)
  - `python/pixel_agent/` (`__main__.py`, `protocol.py`, `loop.py`, `providers.py`, `compressor.py`, `crash_log.py`)
  - `src/main/services/pythonAgentBridge.ts` (upgrade to `pixel-agent-v2` NDJSON streaming + `backend-ownership` PID/startMarker file + corrupt quarantine)
  - `src/main/ipc.ts` (route turns through Python when enabled, with automatic TS `AgentExecutor` fallback)
- **Protocol (`pixel-agent-v2` NDJSON over stdio):**
  - Main → Python: `turn.start` (messages, tool schemas, ephemeral provider config, budgets), `tool.response` (approved result or denial), `turn.cancel`, `ping`, `shutdown`.
  - Python → Main: `turn.delta`, `turn.reasoning`, `tool.request` (`callId`, `name`, `args`), `task.step`, `turn.complete`, `turn.error`.
- **Security:** Python never receives DPAPI store access or direct UIA/shell bypass; every `tool.request` passes through main-process `PermissionBroker`.
- **Tests & Acceptance:** Parity tests comparing Python vs. TS turns, streaming cancellation, crash-log creation, orphan PID reaping, and automatic fallback on missing Python.
- **Rollback:** Set `agent.runtimeEngine = 'typescript'` (default until Phase A parity suite is 100% green).

## Phase B — Git, Files & Scoped Execution
- **Objective:** Complete developer workflow tools and fix remaining file-tool test portability.
- **Files to create/modify:**
  - `src/main/files/toolset.ts` (add injectable `allowedRoot` defaulting to `homedir()`, add fuzzy `file_patch` tool, optional PDF/Office text extraction bridge)
  - `src/main/git/toolset.ts` (wire `git_stage`, `git_diff` stats, branch/PR workflow helpers)
  - `src/main/plugins/github.ts` + `src/main/plugins/manifest.ts` (register expanded GitHub tools: `github_read_file`, `github_list_issues`, `github_list_prs`, `github_repo_branches`, `github_workflow_runs`, authenticated DPAPI token support)
  - `tests/files.test.ts`, `tests/tasks.test.ts` (migrate fixtures from `homedir()` to `os.tmpdir()`)
- **Security:** `shell: false` everywhere, HTTPS-only `git_clone`, `git_push` always `critical` (no `--force`), Agent-mode autonomy limited strictly to `AGENT_MODE_AUTONOMOUS_TOOLS`.
- **Acceptance:** End-to-end Git clone + inspect + edit + diff + commit in Agent mode without unnecessary read prompts, while `git_push` and `file_trash` still require explicit approval.

## Phase C — Memory, Session Search & Procedural Skills
- **Objective:** Adopt Hermes's frozen-snapshot memory stability, `session_search` FTS5 recall, and scanned Markdown `SKILL.md` playbooks.
- **Files to create/modify:**
  - `src/main/data/migrations.ts` (migration: FTS5 virtual table over `messages` for `session_search`, `memory_kind` user-profile vs project-knowledge char-budget index)
  - `src/main/memory/context.ts` (freeze memory snapshot per session ID for prompt-cache stability)
  - `src/main/memory/toolset.ts` (add `session_search` tool)
  - `src/main/skills/markdownSkills.ts` (progressive-disclosure `SKILL.md` loader + static threat/secret scanner + explicit user review before activation)
- **Acceptance:** Irrelevant chats create 0 memories; cross-session `session_search` recalls prior project decisions; prompt-injection patterns in `SKILL.md` are blocked deterministically.

## Phase D — Plugin System & MCP Client
- **Objective:** Expand Pixel's bundled plugin foundation with a real MCP client (`stdio` + `Streamable HTTP` + OSV preflight) and Tier-1 Python plugins.
- **Files to create/modify:**
  - `python/pixel_agent/mcp_client.py` (long-lived daemon loop, per-server `MCPServerTask`, 12s OSV preflight)
  - `src/main/plugins/store.ts` & `src/main/plugins/manifest.ts` (MCP server declarations, OAuth/DPAPI connection records, health checks)
  - `src/renderer/components/WorkspacePluginManager.tsx` (Browse / Installed / Connections tabs inside Settings → Plugins & Connections)
- **Security:** Third-party code NEVER runs in Electron main; MCP servers run in isolated child processes with explicit per-project allowlists and automatic grant revocation on disable/uninstall.

## Phase E — Durable Background Tasks, Cron & Parallel Delegation
- **Objective:** Make Running Tasks reflect true durable engine state across restarts and minimize-to-tray.
- **Files to create/modify:**
  - `src/main/data/migrations.ts` (add `execution_scope` (`headless` | `desktop_session`), `checkpoint_json`, `lease_pid`, `cron_expression` to `tasks` / `routines`)
  - `python/pixel_agent/scheduler.py` (`croniter` + `tzdata` + `msvcrt` lock file + missed-run recovery)
  - `src/main/agents/coordinator.ts` (parallel batch delegation with concurrency cap 3, parent `AbortSignal` propagation, child heartbeats)
- **Acceptance:** Minimizing Pixel continues headless tasks; restarting Pixel marks interrupted tasks `recovering` → `paused` cleanly; completed chat replies never pollute Running Tasks.

## Phase F — Desktop Hardening & UX Polish
- **Objective:** Close Electron security gaps and polish Pixel Board & Workspace ergonomics.
- **Files to create/modify:**
  - `src/main/window.ts` (add `setWindowOpenHandler` delegating `https://` to `shell.openExternal` and `will-navigate` guard on all `BrowserWindow`s)
  - `src/renderer/components/PixelBoard.tsx` (multi-select, alignment guides, keyboard shortcuts, connectors)
  - `src/main/ipc.ts` (split 1,886-line monolith into domain IPC routers: `ipc/chat.ts`, `ipc/files.ts`, `ipc/git.ts`, `ipc/plugins.ts`, `ipc/board.ts`)
- **Rollback:** Modular refactors preserve exact `CHANNELS` and `CypsBridge` contracts verified by `tests/architecture.test.ts`.

## Phase G — Verification, Local Windows Runtime & Packaging
- **Objective:** Close Core Tools 6.2 gaps, diagnose and fix Electron `0x80000003` local launch, and verify packaged Windows builds.
- **Work items:**
  - Isolate and fix Electron `0x80000003` exit (`--disable-gpu` / sandbox / stack-cookie diagnostics inspired by Hermes's `windows-sandbox-fallback.ts` & `windows-stack-cookie-fallback.ts`).
  - Enable Electron ASAR integrity fuses in `electron-builder.yml` after verifying packaged startup.
  - Package Python runtime reproducibly for Windows (embedded CPython + locked wheels) and verify voice worker (`faster-whisper` / `kokoro_onnx`) offline inference.
  - Capture real Windows GUI acceptance screenshots (empty & active ASCII shark chat, narrow window, reduced motion, 11-category Settings, Running Tasks, native dialogs).
