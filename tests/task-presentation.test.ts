import { describe, expect, it } from 'vitest';
import { countVerifiedSteps, taskDisplayState } from '../src/renderer/lib/task-presentation';

describe('task display state', () => {
  it('does not present a completed record as complete while UI postconditions are pending', () => {
    expect(taskDisplayState({
      status: 'completed',
      pendingVerifications: [{ stepId: 'step-1', toolName: 'invoke_ui_element' }],
    })).toEqual({ label: 'Needs verification', tone: 'blocked', verificationPending: true });
  });

  it('keeps verified completion and the underlying task status unchanged', () => {
    expect(taskDisplayState({ status: 'completed', pendingVerifications: [] })).toEqual({
      label: 'completed', tone: 'completed', verificationPending: false,
    });
  });

  it('does not count a step with a pending postcondition as verified', () => {
    const steps = [
      { id: 'step-1', status: 'done' as const, title: 'Invoke control' },
      { id: 'step-2', status: 'done' as const, title: 'Read result' },
      { id: 'step-3', status: 'verified' as const, title: 'Verify outcome' },
    ];
    expect(countVerifiedSteps({
      steps,
      pendingVerifications: [
        { stepId: 'step-1', toolName: 'invoke_ui_element' },
        { stepId: 'step-3', toolName: 'verify_ui_state' },
      ],
    })).toBe(1);
  });
});
