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
- [ ] Add `setWindowOpenHandler` and `will-navigate` guards to all Electron `BrowserWindow`s in `src/main/window.ts`
- [ ] Split `src/main/ipc.ts` into domain IPC routers
- [ ] Enhance Pixel Board (multi-select, alignment, connectors, shortcuts)

## Phase G — Verification & Windows Acceptance
- [ ] Diagnose & fix local Electron `0x80000003` exit on Windows
- [ ] Verify packaged Windows installer (NSIS + portable), ASAR integrity fuses, and voice worker inference
- [ ] Capture live Windows GUI visual acceptance evidence (empty/active ASCII sharks, narrow layout, reduced motion, 11-category Settings, Running Tasks)
