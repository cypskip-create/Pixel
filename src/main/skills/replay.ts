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

  const suppliedInputs = options.inputs ?? {};
  const substituted = substituteInputs(skill, suppliedInputs);
  if (typeof substituted === 'string') return { status: 'failed', steps: [], failure: substituted };

  const runId = store.startRun(skill);
  try {
    const workflow = asWorkflow(substituted);
    const result = await replayWorkflow(workflow, {
      run: async (step, signal) => {
        try {
          const outcome = await runner.run(step, signal);
          return { ...outcome, observed: redactValues(outcome.observed, Object.values(suppliedInputs)) };
        } catch (error) {
          throw new Error(redactValues(error instanceof Error ? error.message : String(error), Object.values(suppliedInputs)));
        }
      },
    }, {
      ...options,
      onStep: (outcome) => options.onStep?.({
        ...outcome,
        detail: redactValues(outcome.detail, Object.values(suppliedInputs)),
      }),
      authorize: (step) => {
        const stored = skill.steps.find((candidate) => candidate.ordinal === step.ordinal);
        const current = options.authorize(step);
        if (stored?.approvalRequired && current.allowed) {
          return { allowed: false, needsApproval: true, reason: 'This reviewed skill step always asks before execution.' };
        }
        return { ...current, reason: redactValues(current.reason, Object.values(suppliedInputs)) };
      },
    });
    const safeResult: ReplayResult = {
      ...result,
      steps: result.steps.map((step) => ({ ...step, detail: redactValues(step.detail, Object.values(suppliedInputs)) })),
      ...(result.failure ? { failure: redactValues(result.failure, Object.values(suppliedInputs)) } : {}),
    };
    store.finishRun(runId, {
      status: safeResult.status === 'completed' ? 'completed'
        : safeResult.status === 'cancelled' ? 'cancelled'
          : safeResult.status === 'denied' ? 'denied' : 'failed',
      stepCount: safeResult.steps.length,
      ...(safeResult.failure ? { summary: safeResult.failure } : {}),
    });
    return safeResult;
  } catch (error) {
    store.finishRun(runId, { status: 'failed', stepCount: 0, summary: 'Skill replay failed before completion.' });
    throw new Error(redactValues(error instanceof Error ? error.message : String(error), Object.values(suppliedInputs)));
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
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return 'Skill inputs must be a plain map of declared text values.';
  }
  const entries = Object.entries(inputs);
  if (entries.length > 30) return 'A skill run accepts at most 30 declared inputs.';
  const definitions = new Map(skill.inputs.map((input) => [input.name, input]));
  for (const [name, definition] of definitions) {
    if (definition.required && (!inputs[name] || inputs[name].trim().length === 0)) {
      return `Required skill input "${name}" was not provided.`;
    }
  }
  for (const [name, value] of entries) {
    if (!definitions.has(name)) return `Unknown skill input "${name}" was refused.`;
    if (typeof value !== 'string' || value.length > 2_000) {
      return `Skill input "${name}" must be text of at most 2,000 characters.`;
    }
    if (looksLikeCredential(value)) return `Skill input "${name}" resembles credential material and was refused.`;
  }

  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const match = /^\$\{input\.([a-z][a-z0-9_]{0,39})\}$/.exec(value);
      if (!match && value.includes('${input.')) throw new Error('A skill parameter contains a malformed input placeholder.');
      return match ? inputs[match[1] ?? ''] ?? '' : value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    }
    return value;
  };
  try {
    return { ...skill, steps: skill.steps.map((step) => ({ ...step, params: replace(step.params) as Record<string, unknown> })) };
  } catch (error) {
    return error instanceof Error ? error.message : 'Skill input substitution failed.';
  }
}

function looksLikeCredential(value: string): boolean {
  return /\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\bsk-[A-Za-z0-9_-]{12,}\b|\bAKIA[0-9A-Z]{16}\b|\b(password|passwd|passphrase|api[_ -]?key|access[_ -]?token|secret|authorization)\b\s*[:=]\s*[^\s,;]+/i.test(value);
}

function redactValues(value: string, values: string[]): string {
  let safe = value;
  for (const input of [...new Set(values)].filter((candidate) => candidate.trim().length > 0).sort((left, right) => right.length - left.length)) {
    const needle = input.toLowerCase();
    const lower = safe.toLowerCase();
    let cursor = 0;
    let found = lower.indexOf(needle, cursor);
    if (found < 0) continue;
    let redacted = '';
    while (found >= 0) {
      redacted += safe.slice(cursor, found) + '[redacted input]';
      cursor = found + input.length;
      found = lower.indexOf(needle, cursor);
    }
    safe = redacted + safe.slice(cursor);
  }
  return safe;
}
