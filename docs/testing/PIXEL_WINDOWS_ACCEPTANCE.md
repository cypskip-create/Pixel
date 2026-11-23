# Pixel — Windows Acceptance & Cross-Phase Verification Report

**Date:** 2026-11-23  
**Baseline Commit:** `0a01a147129dbbf1181d521ef351e920d978bc04`  
**Phase F Windows CI:** Run [`45223028456`](https://github.com/cypskip-create/Pixel/actions/runs/45223028456) — **PASSED (`windows: completed/success`)**

---

## 1. Cross-Phase Functional Acceptance Matrix (Phases A–G)

| Phase / Journey | Automated Acceptance Suite | Outcome |
| :--- | :--- | :--- |
| **Phase A — Python Agent Engine (`pixel-agent-v2`)** | `tests/python-agent-bridge.test.ts` (2), `tests/python-agent-parity.test.ts` (10), `python/tests/test_pixel_agent.py` (11) | **PASS** |
| **Phase B — Git, Files, Rich Docs & GitHub** | `tests/phase-b-git-files-github.test.ts`, `tests/files.test.ts` (20), `tests/git-and-agent-autonomy.test.ts` (7) | **PASS** |
| **Phase C — Memory, FTS5 Search & `SKILL.md`** | `tests/phase-c-memory-skills.test.ts` (4), `tests/memory.test.ts` (44), `tests/skills-routines.test.ts` (14) | **PASS** |
| **Phase D — MCP Client, Plugins & Google Calendar** | `tests/phase-d-mcp-plugins.test.ts` (4), `python/tests/test_mcp_client.py` (3) | **PASS** |
| **Phase E — Durable Tasks, Cron & Parallel Specialists** | `tests/phase-e-durable-tasks-scheduler-delegation.test.ts` (10), `tests/tasks.test.ts` (10) | **PASS** |
| **Phase F — Electron Hardening, Modular IPC & Pixel Board** | `tests/phase-f-hardening-ipc-board.test.ts` (7), `tests/window-policy.test.ts` (6), `tests/architecture.test.ts` (18) | **PASS** |
| **Phase G — Settings Parity, Packaging & Voice** | `tests/phase-g-settings-parity.test.ts` (3), `tests/artifacts.test.ts` (11), `tests/nsis.test.ts` (9), `tests/voice.test.ts` (25), `python/tests/test_voice_worker.py` (9) | **PASS** |
| **Theme & Desktop Materiality** | `tests/monochrome-theme.test.ts` (7), `tests/agent-activity-bar.test.tsx` (5), `tests/workspace-components.test.tsx` (8) | **PASS** |

---

## 2. Explicitly Open / Unverified Acceptance Items

1. **Interactive Electron GUI Launch & Live Screenshots:** Blocked on this sandboxed host because `electron.exe --version` exits `-2147483645` (`0x80000003`) before Pixel JavaScript entry. Must be executed on an unsandboxed Windows desktop machine.
2. **Live External Cloud Credentials:** Live Google Calendar OAuth (`PIXEL_GOOGLE_OAUTH_CLIENT_ID`), live GitHub PAT API calls, and live DeepSeek cloud inference require user-owned credentials.
3. **Full Hermes Functional Parity Expansion:** Tracked with exact 161-entry source-grounded denominator in [HERMES_PIXEL_SETTINGS_MATRIX.md](../parity/HERMES_PIXEL_SETTINGS_MATRIX.md) and prioritized in [HERMES_FUNCTIONAL_PARITY_ROADMAP.md](../parity/HERMES_FUNCTIONAL_PARITY_ROADMAP.md).
