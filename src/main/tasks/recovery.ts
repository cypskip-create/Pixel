import type { TaskExecutionScope, TaskRecord, TaskStep } from '../../shared/types';

/**
 * Tools that require an interactive Windows desktop session (screen reading,
 * UI Automation, mouse/keyboard input, window focus, or headed browser control).
 */
const DESKTOP_TOOL_PREFIXES = [
  'uia_',
  'window_',
  'mouse_',
  'keyboard_',
  'desktop_',
  'screen_',
] as const;

const DESKTOP_TOOL_NAMES = new Set<string>([
  'analyze_screen',
  'capture_screen',
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'hotkey',
  'scroll',
  'focus_window',
  'list_windows',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_screenshot',
]);

/**
 * Tools with external or local state-changing side effects that must NEVER be
 * blindly replayed after an unexpected crash or restart.
 */
const READ_ONLY_TOOL_NAMES = new Set<string>([
  'get_current_time',
  'get_system_info',
  'analyze_screen',
  'file_read',
  'file_list',
  'file_search_content',
  'documents_search',
  'documents_list',
  'memory_search',
  'memory_list',
  'session_search',
  'skills_list',
  'skill_view',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch_list',
  'git_remote_list',
  'git_repository_info',
  'github_repo_summary',
  'github_repo_branches',
  'github_list_dir',
  'github_read_file',
  'github_list_commits',
  'github_compare_commits',
  'github_list_issues',
  'github_issue_detail',
  'github_list_prs',
  'github_workflow_runs',
  'gcal_list_calendars',
  'gcal_list_events',
  'gcal_get_event',
  'gcal_free_busy',
  'browser_open_search',
  'browser_navigate',
  'browser_inspect',
  'browser_verify',
  'search_web',
  'web_search',
  'web_fetch',
]);

export function classifyToolExecutionScope(toolName: string | undefined): TaskExecutionScope {
  if (!toolName) return 'headless';
  const normalized = toolName.trim().toLowerCase();
  if (DESKTOP_TOOL_NAMES.has(normalized)) return 'desktop_session';
  if (DESKTOP_TOOL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return 'desktop_session';
  }
  return 'headless';
}

export function inferTaskExecutionScope(task: Pick<TaskRecord, 'executionScope' | 'allowedTools' | 'steps'>): TaskExecutionScope {
  if (task.executionScope) return task.executionScope;
  for (const step of task.steps) {
    if (classifyToolExecutionScope(step.toolName) === 'desktop_session') {
      return 'desktop_session';
    }
  }
  for (const tool of task.allowedTools ?? []) {
    if (classifyToolExecutionScope(tool) === 'desktop_session') {
      return 'desktop_session';
    }
  }
  return 'headless';
}

/**
 * Fail-closed side-effect classifier: any tool not explicitly known to be
 * read-only / idempotent (including unknown MCP tools, file writes/patches,
 * git commits/pushes, GitHub/Calendar writes, and UI input) is treated as
 * state-changing.
 */
export function isStateChangingTool(toolName: string | undefined): boolean {
  if (!toolName) return false;
  const normalized = toolName.trim().toLowerCase();
  return !READ_ONLY_TOOL_NAMES.has(normalized);
}

export function isLeaseStale(
  task: TaskRecord,
  currentInstanceId: string,
  now: number,
): boolean {
  if (!task.lease) return true;
  if (task.lease.instanceId !== currentInstanceId) return true;
  return task.lease.expiresAt <= now;
}

export interface RecoveryOutcome {
  task: TaskRecord;
  recovered: boolean;
  safeToResume: boolean;
  uncertainSideEffect: boolean;
  reason: string;
}

const INTERRUPTIBLE_STATUSES = new Set<TaskRecord['status']>([
  'queued',
  'planning',
  'running',
  'pause_requested',
  'awaiting_approval',
  'awaiting_user',
  'recovering',
  'cancelling',
]);

/**
 * Safely reconciles a persisted task on startup after a crash or process exit.
 *
 * Safety invariant:
 * - State-changing steps that were in-flight when Pixel exited are NEVER
 *   blindly replayed. They are marked uncertain (`reobserveRequired: true`,
 *   `safeToResume: false`) and paused for user reconciliation.
 * - Purely read-only / idempotent headless tasks with no pending mutations
 *   are marked `safeToResume: true` so the user or scheduler can safely
 *   continue from the last verified checkpoint.
 */
export function recoverInterruptedTask(
  task: TaskRecord,
  currentInstanceId: string,
  now = Date.now(),
): RecoveryOutcome {
  if (!INTERRUPTIBLE_STATUSES.has(task.status) && task.status !== 'paused') {
    return {
      task,
      recovered: false,
      safeToResume: false,
      uncertainSideEffect: false,
      reason: 'Task is already in a terminal state.',
    };
  }

  if (task.status === 'paused' && task.recoveryNote) {
    return {
      task,
      recovered: false,
      safeToResume: task.safeToResume === true,
      uncertainSideEffect: task.reobserveRequired === true,
      reason: 'Task was already reconciled after a previous restart.',
    };
  }

  const scope = inferTaskExecutionScope(task);
  const inFlightSteps = task.steps.filter((step) => step.status === 'running');
  const uncertainStep = inFlightSteps.find((step) => isStateChangingTool(step.toolName));
  const hasPendingVerification = (task.pendingVerifications?.length ?? 0) > 0;
  const uncertainSideEffect = Boolean(uncertainStep) || hasPendingVerification;
  const safeToResume = !uncertainSideEffect && scope === 'headless' && task.status !== 'awaiting_approval';

  const reconciledSteps: TaskStep[] = task.steps.map((step) => {
    if (step.status !== 'running') return step;
    const isMutating = isStateChangingTool(step.toolName);
    return {
      ...step,
      status: isMutating ? 'failed' : 'pending',
      endedAt: now,
      detail: isMutating
        ? 'Interrupted during a state-changing operation; outcome is uncertain and was not replayed automatically.'
        : 'Interrupted before completion; safe to retry after restart.',
    };
  });

  const reason = uncertainSideEffect
    ? `Pixel restarted while "${uncertainStep?.title ?? task.title}" was executing a state-changing operation. The action was NOT replayed automatically; verify its outcome before continuing.`
    : safeToResume
      ? 'Pixel restarted while this read-only headless task was active. Verified checkpoint loaded; safe to resume.'
      : scope === 'desktop_session'
        ? 'Pixel restarted while this desktop-session task was active. Re-verify the target window and desktop state before resuming.'
        : 'Pixel restarted while this task was active. Review the last completed step before resuming.';

  const updated: TaskRecord = {
    ...task,
    status: 'paused',
    executionScope: scope,
    steps: reconciledSteps,
    pauseRequested: false,
    safeToResume,
    reobserveRequired: uncertainSideEffect || scope === 'desktop_session' || task.reobserveRequired === true,
    recoveryNote: reason,
    lease: {
      instanceId: currentInstanceId,
      pid: process.pid,
      acquiredAt: now,
      expiresAt: now,
      lastHeartbeatAt: now,
    },
    checkpoint: {
      phase: 'before_tool',
      at: now,
      summary: safeToResume
        ? 'Restart recovery: verified checkpoint ready; no action was resumed automatically.'
        : 'Restart recovery: no action was resumed automatically; paused for review.',
    },
    evidence: [
      ...(task.evidence ?? []),
      {
        id: `recovery_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: 'recovery' as const,
        summary: reason,
        source: `Startup recovery (${currentInstanceId})`,
        at: now,
      },
    ].slice(-100),
    updatedAt: now,
  };

  return {
    task: updated,
    recovered: true,
    safeToResume,
    uncertainSideEffect,
    reason,
  };
}
