import type { ToolRegistry } from '../agent/tools';
import type { SkillDefinition, SkillInput } from './schema';

const SUPPORTED_EXPECTATIONS = new Set([
  'resultContains',
  'urlPrefix',
  'reobserveBeforeReplay',
  'verifyCurrentPostcondition',
  'recordedOutcome',
]);

/** Return whether a reviewed skill can currently run as a scheduled routine. */
export function routineIncompatibility(skill: Pick<SkillDefinition, 'inputs' | 'steps' | 'requiredTools'>): string | null {
  if (skill.steps.length === 0 || skill.steps.length > 40) return 'A daily routine requires 1 to 40 reviewed tool steps.';
  if (skill.steps.some((step) => step.kind !== 'tool' || step.action !== step.locator || step.action === 'request_human_takeover')) {
    return 'Daily routines currently support only reviewed tool steps with direct tool names.';
  }
  if (skill.steps.some((step) => !skill.requiredTools.includes(step.action))) {
    return 'Every routine step must be included in the skill’s declared requiredTools list.';
  }
  if (skill.steps.some((step) => !isSupportedSkillExpectation(step.expectation))) {
    return 'A daily routine contains an unsupported expected-result check. Use resultContains, urlPrefix, or the built-in postcondition flags.';
  }
  return null;
}

/** Build the immutable ordered calls used by the live AgentExecutor adapter. */
export function buildRoutineToolPlan(
  skill: SkillDefinition,
  requestId: string,
  registry: ToolRegistry,
  inputs: Record<string, string> = {},
): ReviewedToolCall[] {
  const incompatibility = routineIncompatibility(skill);
  if (incompatibility) throw new Error(incompatibility);
  return buildSkillToolPlan(skill, requestId, registry, inputs);
}

export interface ReviewedToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  expectation: Record<string, unknown>;
  approvalRequired: boolean;
}

export function buildSkillToolPlan(
  skill: SkillDefinition,
  requestId: string,
  registry: ToolRegistry,
  inputs: Record<string, string>,
): ReviewedToolCall[] {
  if (skill.steps.length === 0 || skill.steps.length > 40) throw new Error('A manual skill run requires 1 to 40 reviewed tool steps.');
  if (skill.steps.some((step) => step.kind !== 'tool' || step.action !== step.locator || step.action === 'request_human_takeover')) {
    throw new Error('Manual runs currently support only reviewed tool steps with direct tool names.');
  }
  const normalizedInputs = normalizeSkillInputValues(skill.inputs, inputs);
  const inputNames = new Map(skill.inputs.map((input) => [input.name, input]));
  const substitute = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const match = /^\$\{input\.([a-z][a-z0-9_]{0,39})\}$/.exec(value);
      if (!match) {
        if (value.includes('${input.')) throw new Error('A skill parameter contains a malformed input placeholder.');
        return value;
      }
      const name = match[1] ?? '';
      if (!inputNames.has(name)) throw new Error(`Unknown skill input "${name}" was refused.`);
      return normalizedInputs[name] ?? '';
    }
    if (Array.isArray(value)) return value.map(substitute);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, substitute(child)]));
    return value;
  };
  return [...skill.steps]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((step, index) => {
      if (!registry.get(step.action)) throw new Error(`This build cannot schedule the skill because "${step.action}" is unavailable.`);
      if (!skill.requiredTools.includes(step.action)) throw new Error(`Skill step ${String(step.ordinal + 1)} is missing from requiredTools.`);
      if (!isSupportedSkillExpectation(step.expectation)) throw new Error(`Skill step ${String(step.ordinal + 1)} has an unsupported expected-result check.`);
      const params = substitute(step.params) as Record<string, unknown>;
      const validation = registry.validateArgs(step.action, params);
      if (!validation.ok) throw new Error(`Skill step ${String(step.ordinal + 1)} has invalid arguments: ${validation.message}`);
      return {
        id: `${requestId}_planned_${String(index + 1)}`,
        name: step.action,
        argumentsJson: JSON.stringify(params),
        expectation: step.expectation,
        approvalRequired: step.approvalRequired,
      };
    });
}

/** Validate declared values before a one-time run or local scheduled storage. */
export function normalizeSkillInputValues(definitions: readonly SkillInput[], raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Skill inputs must be a plain object of declared text values.');
  }
  const values = raw as Record<string, unknown>;
  const declared = new Map(definitions.map((definition) => [definition.name, definition]));
  const entries = Object.entries(values);
  if (entries.length > 30) throw new Error('A skill run accepts at most 30 declared inputs.');
  const normalized: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!declared.has(name)) throw new Error(`Unknown skill input "${name.slice(0, 40)}" was refused.`);
    if (typeof value !== 'string' || value.length > 2_000) {
      throw new Error(`Skill input "${name}" must be text of at most 2,000 characters.`);
    }
    if (looksLikeCredential(value)) throw new Error(`Skill input "${name}" resembles credential material and was refused.`);
    normalized[name] = value;
  }
  for (const [name, definition] of declared) {
    if (definition.required && (!normalized[name] || normalized[name]?.trim().length === 0)) {
      throw new Error(`Required skill input "${name}" was not provided.`);
    }
  }
  return normalized;
}

function looksLikeCredential(value: string): boolean {
  return /\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\bsk-[A-Za-z0-9_-]{12,}\b|\bAKIA[0-9A-Z]{16}\b|\b(password|passwd|passphrase|api[_ -]?key|access[_ -]?token|secret|authorization)\b\s*[:=]\s*[^\s,;]+/i.test(value);
}

export function isSupportedSkillExpectation(expectation: Record<string, unknown>): boolean {
  return Object.entries(expectation).every(([key, value]) => {
    if (!SUPPORTED_EXPECTATIONS.has(key)) return false;
    if (key === 'resultContains') return typeof value === 'string' && value.length > 0 && value.length <= 2_000;
    if (key === 'urlPrefix') {
      if (typeof value !== 'string' || value.length > 2_048) return false;
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch { return false; }
    }
    if (key === 'reobserveBeforeReplay' || key === 'verifyCurrentPostcondition') return typeof value === 'boolean';
    return value === 'done' || value === 'verified';
  });
}
