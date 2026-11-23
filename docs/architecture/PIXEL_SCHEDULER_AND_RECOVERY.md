# Pixel Phase E — Cron Scheduler, Transactional Locking & Crash Recovery

**Status:** Implemented & Verified Locally (on top of `b6526d2`)  
**Primary Modules:**
- `src/main/routines/cron.ts` — Pure IANA-timezone-aware 5-field cron parser and occurrence evaluator.
- `src/main/routines/lease.ts` — SQLite transactional `SchedulerLeaseManager`.
- `src/main/routines/index.ts` — Multi-schedule `RoutineStore` and `LocalRoutineScheduler`.
- `src/main/tasks/recovery.ts` — Safe startup crash recovery and side-effect classification.

---

## 1. Cron Engine & Windows Time-Zone / DST Behavior

Pixel implements a zero-dependency, deterministic 5-field cron engine (`minute hour dom month dow`, plus `@hourly`, `@daily`, `@midnight`, `@weekly`, `@monthly`) using `Intl.DateTimeFormat` with explicit IANA time zones (`validateTimezone`).

- **No OS Local Time-Zone Assumption:** Every routine stores its explicit IANA timezone (e.g., `America/New_York`, `UTC`, `Europe/Berlin`).
- **DST Spring-Forward:** Non-existent wall-clock times (e.g. `2026-03-08 02:30 America/New_York`) are skipped cleanly to the next valid occurrence without hanging or misfiring.
- **DST Fall-Back:** Repeated wall-clock hours (e.g. `2026-11-01 01:30 America/New_York`) are deduplicated by `localKey` (`YYYY-MM-DDTHH:mm@IANA`) so a scheduled job never fires twice for the same local wall-clock occurrence.
- **Supported Schedule Kinds:** `daily` (legacy `HH:mm` preserved), `weekly`, `cron` (5-field expression), `interval` (`intervalMs >= 60_000`), and `once` (`runAt` timestamp, automatically disabled on completion).

---

## 2. Scheduler Ownership & Duplicate Prevention

Duplicate execution across multiple Pixel instances or workers is prevented by two independent database-backed barriers:

1. **SQLite Transactional Lease (`SchedulerLeaseManager` on `scheduler_leases`):**
   - Before each tick evaluates due routines, the scheduler atomically acquires or renews its `pixel-routine-scheduler` lease inside a SQLite transaction (`owner_id`, `pid`, `heartbeat_at`, `expires_at`).
   - If another live instance holds an unexpired lease, the tick returns immediately without dispatching work.
   - Stale leases (`expires_at <= now`) are atomically reclaimed on crash/restart.
2. **Idempotent Occurrence Claim (`UNIQUE(routine_id, scheduled_key)` on `routine_runs`):**
   - Even if a lease handoff happens mid-minute, `INSERT OR IGNORE INTO routine_runs` guarantees at most one execution per `(routine_id, scheduled_key)`.

---

## 3. Missed-Run Recovery Policies

When Pixel restarts after being offline, `LocalRoutineScheduler` inspects due occurrences (hard-capped at 10 per tick to prevent unbounded catch-up storms) and applies the routine's configured `missedRunPolicy`:

| Policy | Behavior |
| :--- | :--- |
| `skip` (default) | Records each missed occurrence as `missed` with cause; never replays late. |
| `notify_only` | Records as `missed` and emits `onMissedNotification` for audit/user visibility; never replays. |
| `run_once` | Collapses older missed occurrences into `missed` records and executes **at most 1** catch-up run. |
| `catch_up_window` | Executes **at most 1** missed run if the latest missed occurrence is within `catchupWindowMs` (default 60m, capped at 24h); skips and notifies otherwise. |

If a scheduled run fails with `denied` or `failed` (e.g., revoked permission or expired credential), the routine is automatically disabled rather than endlessly retrying.

---

## 4. Crash Recovery Algorithm (`src/main/tasks/recovery.ts`)

On startup, `TaskManager` passes every persisted non-terminal task through `recoverInterruptedTask(task, currentInstanceId, now)`:

1. Inspects all steps with `status === 'running'` and any `pendingVerifications`.
2. Classifies each in-flight tool via fail-closed `isStateChangingTool(toolName)` — only explicitly verified read-only tools are treated as idempotent; all mutations (`file_patch`, `file_write`, `git_commit`, `git_push`, GitHub/Calendar writes, UI input, unknown MCP tools) are treated as state-changing.
3. **Uncertain Side-Effect Protection:** If any in-flight step is state-changing (or verification is pending), the step is marked `failed` with an explicit uncertainty detail, `reobserveRequired: true`, `safeToResume: false`, and the task is paused with a recovery audit evidence entry. **No state-changing operation is ever blindly replayed.**
4. **Safe Read-Only Headless Tasks:** In-flight read-only steps are reset to `pending`, `safeToResume: true` is set, and the task is paused cleanly at its verified checkpoint ready for user/scheduler resumption.
