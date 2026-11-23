# Pixel Implementation Checklist (Phases A–G)

Use this checklist to execute the next implementation phase in dependency order.

## Phase A — Python Agent Engine
- [x] Create `python/pyproject.toml` (zero-dependency pure-stdlib Phase A baseline; third-party lockfile deferred to Phase D/E MCP/cron)
- [x] Implement `pixel-agent-v2` NDJSON streaming protocol in `python/pixel_agent/`
- [x] Add `PythonAgentOwnershipEntry` (PID + startMarker + `.corrupt` quarantine) and crash log to `PythonAgentBridge`
- [x] Add tool-output pruning + middle-turn compression + deterministic fallback
- [x] Pass TS-vs-Python parity test suite (12/12) with rollback flag `agent.runtimeEngine` (default `'typescript'`)

## Phase B — Git, Files & Execution
- [ ] Add injectable `allowedRoot` to `FileTools` and move `tests/files.test.ts` + `tests/tasks.test.ts` to `os.tmpdir()`
- [ ] Add fuzzy `file_patch` tool and rich document extraction in `file_read`
- [ ] Expose expanded GitHub tools (`github_read_file`, `github_list_issues`, `github_list_prs`, `github_repo_branches`, `github_workflow_runs`) in plugin manifest & executor
- [ ] Add DPAPI-backed optional GitHub auth token flow in Settings → Plugins & Connections

## Phase C — Memory & Skills
- [ ] Add SQLite FTS5 migration over `messages` + `session_search` agent tool
- [ ] Freeze per-session memory snapshot (User Profile + Project Knowledge char-capped blocks)
- [ ] Add progressive-disclosure `SKILL.md` procedural playbooks with static threat scanner and review gate

## Phase D — Plugin System & MCP
- [ ] Implement Python MCP client (`stdio` + `Streamable HTTP` + 12s OSV preflight)
- [ ] Wire MCP server management & health states into Settings → Plugins & Connections
- [ ] Enforce per-project availability & automatic grant revocation on disable/uninstall
- [ ] Research & implement first real external productivity plugin (Drive / Calendar / Email) with real OAuth

## Phase E — Background Tasks & Delegation
- [ ] Add `execution_scope`, `checkpoint_json`, `lease_pid`, `cron_expression` DB migration
- [ ] Implement `croniter` + `tzdata` + `msvcrt` lockfile scheduler with missed-run recovery
- [ ] Upgrade `SpecialistCoordinator` with parallel batches (cap 3), abort propagation & child heartbeats

## Phase F — Desktop Hardening & Polish
- [ ] Add `setWindowOpenHandler` and `will-navigate` guards to all Electron `BrowserWindow`s in `src/main/window.ts`
- [ ] Split `src/main/ipc.ts` into domain IPC routers
- [ ] Enhance Pixel Board (multi-select, alignment, connectors, shortcuts)

## Phase G — Verification & Windows Acceptance
- [ ] Diagnose & fix local Electron `0x80000003` exit on Windows
- [ ] Verify packaged Windows installer (NSIS + portable), ASAR integrity fuses, and voice worker inference
- [ ] Capture live Windows GUI visual acceptance evidence (empty/active ASCII sharks, narrow layout, reduced motion, 11-category Settings, Running Tasks)
