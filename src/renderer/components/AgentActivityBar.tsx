import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TaskRecord, TaskStep } from '@shared/types';

export interface AgentActivityBarProps {
  activeTask: TaskRecord | null;
  streaming: boolean;
  hasStreamingText?: boolean;
  hasPermissionRequest?: boolean;
  onOpenTaskDetails?: () => void;
}

export type ActivityVisualState = 'working' | 'approval' | 'error';

export interface DerivedActivity {
  label: string;
  detail: string | null;
  visualState: ActivityVisualState;
  stepSummary: string | null;
}

const STEP_STATUS_LABEL: Record<TaskStep['status'], string> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  verified: 'Verified',
  failed: 'Failed',
  skipped: 'Skipped',
};

/**
 * Maps a real tool name from TaskStep.toolName to an honest, human-readable
 * activity label. Never invents or simulates steps.
 */
export function describeToolActivity(toolName: string | undefined): string {
  if (!toolName) return 'Working';
  const normalized = toolName.trim().toLowerCase();
  if (normalized.startsWith('mcp.')) return 'Calling MCP tool';
  if (normalized === 'session_search' || normalized.startsWith('memory_')) return 'Searching memory';
  if (normalized === 'file_patch' || normalized === 'file_write' || normalized === 'file_create' || normalized === 'file_delete') {
    return 'Editing files';
  }
  if (normalized === 'file_read' || normalized === 'file_list' || normalized.startsWith('file_search') || normalized.startsWith('doc_')) {
    return 'Reading files';
  }
  if (normalized.startsWith('git_')) return 'Running Git';
  if (normalized.startsWith('github_')) return 'Calling GitHub';
  if (normalized.startsWith('gcal_')) return 'Checking Google Calendar';
  if (normalized === 'skills_list' || normalized === 'skill_view' || normalized === 'skill_manage') {
    return 'Loading playbook';
  }
  if (normalized.startsWith('web_') || normalized === 'search_web') return 'Searching the web';
  if (normalized.startsWith('shell_') || normalized.startsWith('terminal_') || normalized.startsWith('command_')) {
    return 'Running command';
  }
  return `Running ${toolName}`;
}

const SPECIALIST_ACTIVITY_LABEL: Record<string, string> = {
  research: 'Research specialist working',
  browser: 'Browser specialist working',
  systems: 'Systems specialist working',
  knowledge: 'Knowledge specialist working',
  infrastructure: 'Infrastructure specialist working',
};

export function deriveAgentActivity({
  activeTask,
  streaming,
  hasStreamingText = false,
  hasPermissionRequest = false,
}: Pick<AgentActivityBarProps, 'activeTask' | 'streaming' | 'hasStreamingText' | 'hasPermissionRequest'>): DerivedActivity | null {
  if (!activeTask && !streaming && !hasPermissionRequest) {
    return null;
  }

  if (hasPermissionRequest || activeTask?.status === 'awaiting_approval') {
    const runningStep = activeTask?.steps.find((step) => step.status === 'running')
      ?? activeTask?.steps.find((step) => step.status === 'pending');
    return {
      label: 'Awaiting approval',
      detail: runningStep?.title ?? activeTask?.title ?? 'Review the requested action to continue.',
      visualState: 'approval',
      stepSummary: formatStepSummary(activeTask),
    };
  }

  if (activeTask) {
    const runningStep = activeTask.steps.find((step) => step.status === 'running')
      ?? activeTask.steps.find((step) => step.status === 'pending');
    const visualState: ActivityVisualState = activeTask.status === 'failed' || activeTask.status === 'blocked'
      ? 'error'
      : activeTask.status === 'recovering' || Boolean(activeTask.recoveryNote && activeTask.status === 'paused')
        ? 'approval'
        : 'working';
    const specialistLabel = activeTask.specialistId
      ? SPECIALIST_ACTIVITY_LABEL[activeTask.specialistId] ?? `${activeTask.specialistId} specialist working`
      : null;

    const label = activeTask.status === 'queued'
      ? 'Queued'
      : activeTask.status === 'planning'
        ? 'Planning task'
        : activeTask.status === 'recovering'
          ? 'Recovering interrupted task'
          : activeTask.status === 'paused' && activeTask.recoveryNote
            ? (activeTask.safeToResume ? 'Checkpoint ready to resume' : 'Recovery review required')
            : activeTask.status === 'failed'
              ? 'Failed'
              : activeTask.status === 'cancelled' || activeTask.status === 'cancelling'
                ? 'Stopping'
                : activeTask.routineId && !runningStep?.toolName
                  ? 'Running scheduled job'
                  : runningStep?.toolName
                    ? describeToolActivity(runningStep.toolName)
                    : specialistLabel ?? 'Working';

    return {
      label,
      detail: runningStep?.title ?? activeTask.title,
      visualState,
      stepSummary: formatStepSummary(activeTask),
    };
  }

  return {
    label: hasStreamingText ? 'Writing response' : 'Thinking',
    detail: null,
    visualState: 'working',
    stepSummary: null,
  };
}

function formatStepSummary(task: TaskRecord | null): string | null {
  if (!task || task.steps.length === 0) return null;
  const completed = task.steps.filter((step) => step.status === 'done' || step.status === 'verified').length;
  return `${completed}/${task.steps.length} steps`;
}

export function AgentActivityBar({
  activeTask,
  streaming,
  hasStreamingText = false,
  hasPermissionRequest = false,
  onOpenTaskDetails,
}: AgentActivityBarProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const activity = deriveAgentActivity({
    activeTask,
    streaming,
    hasStreamingText,
    hasPermissionRequest,
  });

  if (!activity) return null;

  const steps = activeTask?.steps ?? [];
  const expandable = steps.length > 0 || Boolean(onOpenTaskDetails && activeTask);

  return (
    <div
      className="workspace-activity-bar"
      data-agent-activity-bar
      data-state={activity.visualState}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="workspace-activity-trigger"
        onClick={() => { if (expandable) setExpanded((open) => !open); }}
        aria-expanded={expandable ? expanded : undefined}
        disabled={!expandable}
      >
        <span className="workspace-activity-dot" aria-hidden="true" />
        <span className="workspace-activity-label">{activity.label}</span>
        {activity.detail ? <span className="workspace-activity-detail">{activity.detail}</span> : null}
        {activity.stepSummary ? <span className="workspace-activity-count">{activity.stepSummary}</span> : null}
        {expandable ? (
          expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />
        ) : null}
      </button>

      {expandable && expanded ? (
        <div className="workspace-activity-steps" data-agent-activity-steps>
          {steps.length > 0 ? (
            <ol>
              {steps.map((step) => (
                <li key={step.id} className="workspace-activity-step">
                  <span>
                    {step.title}
                    {step.toolName ? <code>{step.toolName}</code> : null}
                  </span>
                  <span className="workspace-activity-step-status">{STEP_STATUS_LABEL[step.status]}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {activeTask && onOpenTaskDetails ? (
            <div className="workspace-activity-footer">
              <button
                type="button"
                className="workspace-activity-details-link"
                onClick={onOpenTaskDetails}
              >
                Task details
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
