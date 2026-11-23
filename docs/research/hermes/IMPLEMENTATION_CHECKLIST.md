# Pixel Implementation Checklist (Phases A–G)

Use this checklist to execute the next implementation phase in dependency order.

## Phase A — Python Agent Engine
- [x] Create `python/pyproject.toml` (zero-dependency pure-stdlib Phase A baseline; third-party lockfile deferred to Phase D/E MCP/cron)
- [x] Implement `pixel-agent-v2` NDJSON streaming protocol in `python/pixel_agent/`
- [x] Add `PythonAgentOwnershipEntry` (PID + startMarker + `.corrupt` quarantine) and crash log to `PythonAgentBridge`
- [x] Add tool-output pruning + middle-turn compression + deterministic fallback
- [x] Pass TS-vs-Python parity test suite (12/12) with rollback flag `agent.runtimeEngine` (default `'typescript'`)

## Phase B — Git, Files & Execution
- [x] Add injectable `allowedRoot` to `FileTools` and fix `tests/files.test.ts` + `tests/tasks.test.ts` for Windows CI `os.tmpdir()`
- [x] Add exact + unambiguous fuzzy `file_patch` tool, `file_search_content`, and bounded rich document extraction (DOCX/PPTX/XLSX/PDF) in `file_read`
- [x] Complete local Git toolset (`git_remote_list`, `git_repository_info`, `git_stage`, `git_unstage`, clone protocol hardening)
- [x] Expose expanded GitHub tools (10 read + 3 approval-gated authenticated write tools) in plugin manifest & executor
- [x] Add DPAPI-backed optional GitHub auth token flow in Settings → Plugins & Connections (`WorkspacePluginManager.tsx`)
- [x] Verify Agent-mode scoped autonomy and 5-step real-repo developer workflow through Python `pixel-agent-v2`

## Phase C — Memory & Skills
- [x] Add SQLite FTS5 migration (v14) over persisted conversation messages + `session_search` agent tool
- [x] Freeze per-session memory snapshot (User Profile + Project Knowledge char-capped blocks) with immediate invalidation on explicit corrections
- [x] Add progressive-disclosure `SKILL.md` procedural playbooks with static threat scanner (`guard.ts`), user-pinned protection, and review gate in Settings → Skills & Routines

## Phase D — Plugin System & MCP
- [x] Implement MCP client (`stdio` + `Streamable HTTP` + 12s OSV/command preflight) in Python (`python/pixel_agent/mcp_client.py`, `osv_preflight.py`) and Electron main (`src/main/plugins/mcpManager.ts`, Migration 15)
- [x] Wire MCP server management & health states into Settings → Plugins & Connections (`WorkspacePluginManager.tsx`)
- [x] Enforce per-project availability & automatic grant revocation on disable/uninstall/project-narrowing
- [x] Implement OAuth 2.0 PKCE (`oauth.ts`) + first real external productivity plugin (`GOOGLE_CALENDAR_PLUGIN` / `googleCalendar.ts`, 7 tools) with deterministic test suite (live OAuth requires user-owned `PIXEL_GOOGLE_OAUTH_CLIENT_ID`)

## Phase E — Background Tasks & Delegation
- [x] Add `execution_scope`, `parent_task_id`, `lease_*`, `cron_expression`, `missed_run_policy`, and `scheduler_leases` DB migration (v16) + safe crash recovery (`src/main/tasks/recovery.ts`)
- [x] Implement IANA-timezone/DST-aware 5-field cron engine (`src/main/routines/cron.ts`) + SQLite transactional `SchedulerLeaseManager` (`src/main/routines/lease.ts`) + bounded missed-run recovery (`skip`, `notify_only`, `run_once`, `catch_up_window`)
- [x] Upgrade `SpecialistCoordinator` with parallel batches (hard cap 3), fail-closed empty allowlists, parent-child abort propagation, heartbeats, and conflict-surfacing consolidation + Running Tasks / `AgentActivityBar` integration

## Phase F — Desktop Hardening & Polish
- [x] Add centralized `attachWindowSecurityPolicy` (`setWindowOpenHandler`, `will-navigate`, `will-redirect`, `will-attach-webview`, session permission guards, `validateExternalUrl`) to all 6 Electron `BrowserWindow`s in `src/main/window.ts` and `src/main/app.ts`
- [x] Modularize `src/main/ipc.ts` with `IpcHandlerRegistry` (`src/main/ipc/registry.ts`) and domain IPC routers (`plugins.ts`, `skills.ts`, `audit.ts`) preserving all `CHANNELS` contracts
- [x] Expand Pixel Board (`drawingBoard.ts`, `service.ts`, `PixelBoard.tsx`) with multi-selection (Shift-click + marquee), group move, 20px grid snapping, alignment/distribution, linked connectors following moved objects, zoom, and keyboard shortcuts

## Phase G — Verification, Windows Acceptance & Hermes Settings Parity
- [x] Diagnose local Electron `0x80000003` exit on Windows (`electron.exe --version` reproduces `0x80000003` pre-entry in sandboxed host; documented in `docs/architecture/PIXEL_WINDOWS_PHASE_G.md`; live unsandboxed Windows GUI launch remains open)
- [x] Verify packaged Windows distributions (`tests/artifacts.test.ts` 11/11, `tests/nsis.test.ts` 9/9) and local Python/voice runtime (`tests/voice.test.ts` 25/25, Python `unittest` 26/26)
- [x] Produce exhaustive 161-entry source-grounded Hermes settings inventory & automated reconciliation test (`docs/parity/HERMES_SETTINGS_SOURCE_MAP.json`, `tests/phase-g-settings-parity.test.ts`) + wire `agent.maxTurns` & `agent.maxConcurrentSpecialists` end-to-end
- [ ] Capture live unsandboxed Windows GUI visual acceptance screenshots (empty/active ASCII sharks, narrow layout, reduced motion, Settings hierarchy, Running Tasks, Pixel Board)
- [ ] Execute post-Phase-G **Hermes Functional Parity Expansion** roadmap (`docs/parity/HERMES_FUNCTIONAL_PARITY_ROADMAP.md`)
