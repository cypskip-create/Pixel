# Pixel Phase E — Durable Background Tasks & Parallel Specialist Delegation

**Status:** Implemented & Verified Locally (on top of `b6526d2`)  
**Scope:** Durable task persistence, execution scopes, crash recovery, parallel specialist delegation, cancellation propagation, heartbeats, and Running Tasks / `AgentActivityBar` integration.  
**Design Contract:** [PIXEL_DESKTOP_EXPERIENCE.md](../design/PIXEL_DESKTOP_EXPERIENCE.md)

---

## 1. Durable Task State Machine & Schema (SQLite Migration 16)

Pixel extends its existing `TaskRecord`, `TaskStore`, and `TaskManager` without replacing existing task history or user data.

### Additive Statuses
`TaskStatus` adds `queued` and `recovering` while preserving all existing UI-compatible statuses (`planning`, `running`, `pause_requested`, `awaiting_approval`, `awaiting_user`, `paused`, `blocked`, `cancelling`, `completed`, `failed`, `cancelled`).

### SQLite Migration 16 (`durable-tasks-and-cron-scheduler`)
Additive columns on `tasks`:
- `parent_task_id TEXT` (indexed) — links delegated child tasks to their parent task.
- `execution_scope TEXT NOT NULL DEFAULT 'headless'` (indexed with `status, updated_at`) — `'headless' | 'desktop_session'`.
- `lease_pid INTEGER`, `lease_instance_id TEXT`, `lease_expires_at INTEGER`, `last_heartbeat_at INTEGER` — process ownership and liveness tracking.
- `attempt_count INTEGER NOT NULL DEFAULT 1`, `max_attempts INTEGER NOT NULL DEFAULT 1`.
- `specialist_id TEXT`, `routine_id TEXT`.

All task snapshots pass through `TaskRecordSchema` validation and `sanitizeTask` redaction (masking bearer tokens, API keys, passwords, and secrets in `title`, `request`, `result`, `steps`, `checkpoint`, `recoveryNote`, `failure`, and `evidence`) inside atomic SQLite transactions.

---

## 2. Headless vs. Desktop-Session Execution & Background Lifecycle

Every task is classified into an explicit execution scope (`src/main/tasks/recovery.ts`):

- **`headless`:** Git/GitHub API operations, web research, document indexing, memory/session search, calendar retrieval, and non-GUI MCP tools. Headless tasks continue while Pixel is minimized to the taskbar or tray, provided Pixel's main process remains running.
- **`desktop_session`:** Windows UI Automation (`uia_*`), screen capture/reading (`analyze_screen`, `capture_screen`), mouse/keyboard input (`click`, `type_text`, `press_key`, `scroll`), window control, and interactive headed browser actions.
  - Wired to Electron `powerMonitor` (`lock-screen` and `suspend`) in `src/main/ipc.ts` via `TaskManager.pauseDesktopSessionTasks(...)`.
  - When Windows locks or suspends, `desktop_session` tasks transition safely to paused with `reobserveRequired: true`, while `headless` tasks continue uninterrupted.

### Honest Process Survival Guarantees
- **Minimized to taskbar / tray:** Headless tasks continue while the Pixel Electron process remains alive.
- **Application closed:** Normal in-process tasks stop cleanly; their checkpoints, leases, and schedules persist in SQLite for startup reconciliation on next launch. Pixel does **not** install privileged persistent Windows services or OS scheduled tasks without explicit user authorization, and does not claim detached OS-level survival where none is enabled.

---

## 3. Parallel Specialist Delegation (`src/main/agents/coordinator.ts`)

`SpecialistCoordinator` is extended in place with:
- **Hard Concurrency Cap:** `MAX_CONCURRENT_SPECIALISTS = 3` enforced by a bounded worker pool in `delegateParallel(...)`.
- **Fail-Closed Tool Allowlists:** An explicitly empty `explicitToolAllowlist: []` grants **zero tools** (never unrestricted access). Children cannot widen `parentAllowedTools`, cannot bypass `PermissionBroker` or project isolation, and have nested delegation tools (`delegate_to_specialist`, `delegate_parallel`, `delegate_task`) stripped by default.
- **Parent-Child Cancellation Propagation:** Parent `AbortSignal` and `TaskManager.cancel(parentId)` propagate immediately to all active child `AbortController`s and child `TaskRecord`s. Emergency Stop halts all delegated work and revokes pending approvals.
- **Heartbeats & Monitoring:** Each child task records real heartbeats (`TaskManager.recordHeartbeat`) and real step status transitions (`running` → `verified` / `failed`). `TaskManager.detectStalled(now, stallTimeoutMs)` surfaces stalled workers honestly without fabricating progress.
- **Bounded Structured Results & Conflict Surfacing:** Every child returns a validated, length-bounded `DelegationResult`; `consolidateDelegationResults(...)` refuses to report `completed` if any child failed or was cancelled, and explicitly flags conflicting findings across specialists.

---

## 4. UI Integration (`WorkspaceTasks.tsx` & `AgentActivityBar.tsx`)

- **Running Tasks (`src/renderer/components/WorkspaceTasks.tsx`):** Displays execution scope (`Headless` / `Desktop session`), specialist badge, scheduled indicator, parent-child subtask links and counts, recovery notes, and working Pause / Resume / Continue after review / Cancel controls.
- **Live Activity Pill (`src/renderer/components/AgentActivityBar.tsx`):** Surfaces `Planning task`, `Queued`, `Recovering interrupted task`, `Checkpoint ready to resume`, `Recovery review required`, `Running scheduled job`, and per-specialist labels (`Research specialist working`, `Browser specialist working`, `Systems specialist working`, `Knowledge specialist working`) strictly from real `TaskRecord` state.

---

## 5. Rollback Procedure

1. Migration 16 is purely additive (`ALTER TABLE ... ADD COLUMN` + `CREATE TABLE scheduler_leases`).
2. Existing rows remain 100% readable by older schema-compatible code (`payload` JSON remains the canonical task snapshot).
3. Reverting Phase E requires only reverting the Phase E TypeScript files; no destructive SQLite table rewrite is required.
