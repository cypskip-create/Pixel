import type { TaskRecord } from '../../shared/types';
import type { ToolRegistry } from '../agent/tools';
import type { SkillDraftInput } from './schema';

const FORBIDDEN_TOOLS = new Set([
  'clipboard_read', 'clipboard_copy', 'clipboard_restore', 'clipboard_paste',
  'delegate_to_specialist', 'request_human_takeover',
]);
const SECRET_KEY = /(password|passwd|passphrase|secret|token|api[_-]?key|authorization|cookie|credential|cvv|otp)/i;

/**
 * Turn a completed task's already-redacted tool history into a reviewable
 * skill draft. User values are replaced with required inputs; this function
 * never copies user text, file paths, URLs, or other string arguments into a
 * reusable procedure.
 */
export function draftSkillFromTask(task: TaskRecord, registry: ToolRegistry): SkillDraftInput {
  if (task.status !== 'completed' || task.reobserveRequired || (task.pendingVerifications?.length ?? 0) > 0) {
    throw new Error('Only a completed task with verified outcomes can be recorded.');
  }
  if (!task.projectId) throw new Error('This task is not associated with a project.');
  if (task.steps.length === 0 || task.steps.length > 40) {
    throw new Error('This task has no recordable steps or exceeds the 40-step recording limit.');
  }

  const inputs: SkillDraftInput['inputs'] = [];
  const requiredTools: string[] = [];
  const steps: SkillDraftInput['steps'] = [];

  for (const [index, recorded] of task.steps.entries()) {
    const toolName = recorded.toolName;
    if (!toolName || !registry.get(toolName) || FORBIDDEN_TOOLS.has(toolName)) {
      throw new Error(`Step ${index + 1} is not supported for recording.`);
    }
    if (recorded.status !== 'done' && recorded.status !== 'verified') {
      throw new Error(`Step ${index + 1} did not complete successfully and cannot be recorded.`);
    }
    const args = recorded.args ?? {};
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (SECRET_KEY.test(key) || value === '[redacted]' || value === '[value]') {
        throw new Error(`Step ${index + 1} contains a withheld value and cannot be recorded safely.`);
      }
      if (typeof value === 'string') {
        if (value.length > 2_000) throw new Error(`Step ${index + 1} has a value too large to record.`);
        const inputName = `step_${index + 1}_${safeInputSuffix(key)}`.slice(0, 40);
        if (inputs.some((input) => input.name === inputName)) {
          throw new Error(`Step ${index + 1} has ambiguous repeated input names.`);
        }
        inputs.push({
          name: inputName,
          description: `Value for parameter “${key}” in step ${index + 1}. Pixel did not copy the value from task history.`,
          required: true,
        });
        params[key] = '$' + `{input.${inputName}}`;
        continue;
      }
      if (value === null || typeof value === 'number' || typeof value === 'boolean') {
        params[key] = value;
        continue;
      }
      throw new Error(`Step ${index + 1} has structured arguments that need manual review before recording.`);
    }

    if (!requiredTools.includes(toolName)) requiredTools.push(toolName);
    steps.push({
      ordinal: index,
      kind: 'tool',
      locator: toolName,
      action: toolName,
      params,
      expectation: {
        reobserveBeforeReplay: true,
        verifyCurrentPostcondition: true,
        recordedOutcome: recorded.status,
      },
      approvalRequired: true,
    });
  }

  return {
    schemaVersion: 1,
    projectId: task.projectId,
    name: `Recorded ${requiredTools[0]?.replaceAll('_', ' ') ?? 'task'} workflow`,
    purpose: 'Draft created from a completed Pixel task. Review every step, input, and expected result before activation.',
    triggers: [],
    inputs,
    requiredTools,
    steps,
    decisionBranches: [],
    verificationRules: [
      'Observe the current target and its state before each step; do not assume the recorded state is still present.',
      'Verify the current postcondition after every action and stop immediately if it is absent or ambiguous.',
    ],
    failureHandling: [
      'Stop on an unexpected state, failed action, missing input, or failed verification. Do not continue later steps.',
      'Re-observe before any retry because an interrupted action may have partially completed.',
    ],
    approvalRequirements: [
      'Every recorded action requires fresh review and remains subject to Pixel’s current permission policy at execution time.',
    ],
  };
}

function safeInputSuffix(key: string): string {
  const value = key.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(value) ? value.slice(0, 24) : `value_${value.slice(0, 18)}`;
}
