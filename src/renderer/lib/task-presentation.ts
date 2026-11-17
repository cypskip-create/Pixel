import type { TaskRecord, TaskStatus } from '@shared/types';

export interface TaskDisplayState {
  label: string;
  tone: TaskStatus;
  verificationPending: boolean;
}

/** Keep persisted task state intact while presenting unresolved verification accurately. */
export function taskDisplayState(
  task: Pick<TaskRecord, 'status' | 'pendingVerifications'>,
): TaskDisplayState {
  if (task.status === 'completed' && (task.pendingVerifications?.length ?? 0) > 0) {
    return { label: 'Needs verification', tone: 'blocked', verificationPending: true };
  }

  return {
    label: task.status.replaceAll('_', ' '),
    tone: task.status,
    verificationPending: false,
  };
}

/** Count steps with no remaining postcondition as finished for the task rail. */
export function countVerifiedSteps(
  task: Pick<TaskRecord, 'steps' | 'pendingVerifications'>,
): number {
  const pendingStepIds = new Set((task.pendingVerifications ?? []).map((item) => item.stepId));
  return task.steps.filter((step) =>
    !pendingStepIds.has(step.id) && (step.status === 'verified' || step.status === 'done'),
  ).length;
}
