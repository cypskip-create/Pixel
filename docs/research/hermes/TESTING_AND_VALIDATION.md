# Testing & Validation Analysis

Source authority: `tests/` (9,389 files, 9,241 Python), `apps/desktop/package.json`, `apps/desktop/e2e/`.

## 1. Hermes Test Architecture
- **Python Suite (`pytest`):** 9,241 Python test files organized by subsystem (`tests/agent/`, `tests/tools/`, `tests/gateway/`, `tests/cron/`, `tests/plugins/`, `tests/compat/`). Heavy use of protocol/mock doubles, `ContextVar` profile isolation, and explicit security regression tests (e.g., frozen YOLO mode, empty-allowlist fail-closed `#82010`, MCP narrow allowlist `#141468`, corrupt ownership quarantine `#89298`, prompt-injection blocking).
- **Desktop Suite (`vitest` + `playwright`):**
  - `vitest run --project ui` (React components & state)
  - `vitest run --project electron` (Electron main modules: `backend-ownership.test.ts`, `api-transport.test.ts`, `window-open-policy.test.ts`, `window-controls.test.ts`, `windows-sandbox-fallback.test.ts`)
  - `playwright test e2e/` (real Electron boot, chat, approvals, large-session resume, onboarding, connection tokens)
  - Native Electron fixtures (`test:find-in-page-native`, `test:preview-activity-native`).
- **Execution Note in Phase H1:** Hermes tests were **not executed** on this host because Hermes requires `>=3.11,<3.15` while the host has Python `3.15.2` and no Hermes virtualenv was installed. All findings above are from direct source and config inspection.

## 2. Recommended Test Matrix for Pixel Phases A–G

| Phase | Required Automated Tests | Acceptance Gate |
| --- | --- | --- |
| **Phase A (Python Engine)** | Protocol framing (`pixel-agent-v2`), streaming deltas, cancel/timeout, crash-log & orphan PID reaping, TS-vs-Python parity suite | Both Python & TS fallback paths pass identical turn & cancellation contracts |
| **Phase B (Git/Files/Exec)** | Real temp-dir `git` lifecycle, dirty-tree protection, HTTPS-only clone, fuzzy `patch` round-trip, `file_read` PDF/Office extraction, scoped command policy | 0 shell-injection vectors; `FileTools` tests run in `os.tmpdir()` without `homedir()` EPERM |
| **Phase C (Memory/Skills)** | Frozen session snapshot cache test, noise/question/command rejection, duplicate & contradiction resolution, `session_search` FTS5 recall, `SKILL.md` threat-scan block | Irrelevant chatter produces 0 memories; pinned/reviewed skills cannot be silently overwritten |
| **Phase D (Plugins/MCP)** | Manifest validation, OSV preflight mock, stdio/HTTP MCP tool discovery, per-project enablement, grant revocation on disable/uninstall, DPAPI token isolation | Zero third-party code in Electron main; revoked plugins drop all active grants |
| **Phase E (Background/Delegation)** | Durable task state transitions, restart recovery (`recovering` -> `paused`), `croniter` Windows `tzdata` schedules, parallel child delegation + parent abort propagation | Completed chat replies never appear in Running Tasks; Emergency Stop halts all children |
| **Phase F (Desktop Integration)** | Electron `setWindowOpenHandler`/`will-navigate` security test, titlebar order (`Minimize → Maximize → Close`), 11-category Settings, ASCII sharks empty/active/reduced-motion | Zero orange primary accent / glowing strip regressions; <500 kB renderer entry |
| **Phase G (Windows Acceptance)** | Local Electron launch (`0x80000003` root cause resolved), NSIS/portable package smoke, UIA E2E, voice worker inference | Verified on real Windows desktop with visual screenshots |
