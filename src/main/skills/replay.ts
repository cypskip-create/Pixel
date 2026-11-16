import type { Mode } from '../../shared/types';
import { replayWorkflow } from '../workflows';
import type { ReplayOptions, ReplayResult, StepRunner, Workflow } from '../workflows';
import { SkillStore } from './store';
import type { SkillDefinition } from './schema';

export type SkillReplayOptions = Omit<ReplayOptions, 'mode'> & {
  mode: Mode;
  inputs?: Record<string, string>;
};

/** Execute an active reviewed skill while rechecking the current policy per step. */
export async function replaySkill(
  store: SkillStore,
  id: string,
  runner: StepRunner,
  options: SkillReplayOptions,
): Promise<ReplayResult> {
  const skill = store.getActive(id);
  if (!skill || !store.isIntact(skill)) {
    return { status: 'denied', steps: [], failure: 'Only an intact, user-reviewed active skill can run.' };
  }

  const substituted = substituteInputs(skill, options.inputs ?? {});
  if (typeof substituted === 'string') return { status: 'failed', steps: [], failure: substituted };

  const runId = store.startRun(skill);
  try {
    const workflow = asWorkflow(substituted);
    const result = await replayWorkflow(workflow, runner, {
      ...options,
      authorize: (step) => {
        const stored = skill.steps.find((candidate) => candidate.ordinal === step.ordinal);
        const current = options.authorize(step);
        if (stored?.approvalRequired && current.allowed) {
          return { allowed: false, needsApproval: true, reason: 'This reviewed skill step always asks before execution.' };
        }
        return current;
      },
    });
    store.finishRun(runId, {
      status: result.status === 'completed' ? 'completed'
        : result.status === 'cancelled' ? 'cancelled'
          : result.status === 'denied' ? 'denied' : 'failed',
      stepCount: result.steps.length,
      ...(result.failure ? { summary: result.failure } : {}),
    });
    return result;
  } catch (error) {
    store.finishRun(runId, { status: 'failed', stepCount: 0, summary: 'Skill replay failed before completion.' });
    throw error;
  }
}

function asWorkflow(skill: SkillDefinition): Workflow {
  return {
    id: skill.id,
    projectId: skill.projectId,
    name: skill.name,
    description: skill.purpose,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    steps: skill.steps.map((step) => ({
      ordinal: step.ordinal,
      kind: step.kind,
      locator: step.locator,
      action: step.action,
      params: step.params,
      expectation: step.expectation,
    })),
  };
}

function substituteInputs(skill: SkillDefinition, inputs: Record<string, string>): SkillDefinition | string {
  const definitions = new Map(skill.inputs.map((input) => [input.name, input]));
  for (const [name, definition] of definitions) {
    if (definition.required && (!inputs[name] || inputs[name].trim().length === 0)) {
      return `Required skill input "${name}" was not provided.`;
    }
  }
  for (const name of Object.keys(inputs)) {
    if (!definitions.has(name)) return `Unknown skill input "${name}" was refused.`;
  }

  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const match = /^\$\{input\.([a-z][a-z0-9_]{0,39})\}$/.exec(value);
      return match ? inputs[match[1] ?? ''] ?? '' : value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    }
    return value;
  };
  return { ...skill, steps: skill.steps.map((step) => ({ ...step, params: replace(step.params) as Record<string, unknown> })) };
}
