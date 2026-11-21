import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import { buildRoutineToolPlan, buildSkillToolPlan } from '../src/main/skills/plan';
import type { SkillDefinition } from '../src/main/skills/schema';

function activeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    schemaVersion: 1,
    id: 'skill_test',
    projectId: 'project_test',
    name: 'Open a page',
    purpose: 'Open a reviewed public page and inspect it.',
    triggers: [],
    inputs: [],
    requiredTools: ['browser_inspect', 'browser_navigate'],
    steps: [
      { ordinal: 3, kind: 'tool', locator: 'browser_inspect', action: 'browser_inspect', params: {}, expectation: {}, approvalRequired: false },
      { ordinal: 1, kind: 'tool', locator: 'browser_navigate', action: 'browser_navigate', params: { url: 'https://example.test/page' }, expectation: { urlPrefix: 'https://example.test/', verifyCurrentPostcondition: true }, approvalRequired: true },
    ],
    decisionBranches: [],
    verificationRules: ['Inspect the resulting page.'],
    failureHandling: ['Stop if the URL or page is unexpected.'],
    approvalRequirements: ['Ask before navigation.'],
    status: 'active',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('deterministic routine tool plans', () => {
  const registry = new ToolRegistry(BUILTIN_TOOLS);

  it('preserves reviewed step order, arguments, predicates, and approval floors', () => {
    const plan = buildRoutineToolPlan(activeSkill(), 'routine_run_test', registry);
    expect(plan.map((call) => call.name)).toEqual(['browser_navigate', 'browser_inspect']);
    expect(plan[0]).toMatchObject({
      id: 'routine_run_test_planned_1',
      argumentsJson: '{"url":"https://example.test/page"}',
      expectation: { urlPrefix: 'https://example.test/', verifyCurrentPostcondition: true },
      approvalRequired: true,
    });
  });

  it('refuses missing tools, schema-invalid arguments, interactive inputs, and unsupported steps', () => {
    expect(() => buildRoutineToolPlan(activeSkill({
      requiredTools: ['missing_tool'],
      steps: [{ ordinal: 0, kind: 'tool', locator: 'missing_tool', action: 'missing_tool', params: {}, expectation: {}, approvalRequired: true }],
    }), 'r', registry)).toThrow(/unavailable/);
    expect(() => buildRoutineToolPlan(activeSkill({ steps: [
      { ordinal: 0, kind: 'tool', locator: 'browser_navigate', action: 'browser_navigate', params: {}, expectation: {}, approvalRequired: true },
    ] }), 'r', registry)).toThrow(/invalid arguments/);
    expect(() => buildRoutineToolPlan(activeSkill({ inputs: [{ name: 'url', description: 'Destination URL', required: true }] }), 'r', registry)).toThrow(/interactive inputs/);
    expect(() => buildRoutineToolPlan(activeSkill({ steps: [
      { ordinal: 0, kind: 'browser', locator: '#submit', action: 'browser_click', params: { selector: '#submit' }, expectation: {}, approvalRequired: true },
    ] }), 'r', registry)).toThrow(/tool steps/);
  });

  it('substitutes only declared one-time inputs and refuses secret-like input values', () => {
    const skill = activeSkill({
      inputs: [{ name: 'destination', description: 'Public destination URL', required: true }],
      steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_navigate', action: 'browser_navigate', params: { url: '${input.destination}' }, expectation: { urlPrefix: 'https://example.test/' }, approvalRequired: true }],
      requiredTools: ['browser_navigate'],
    });
    expect(() => buildRoutineToolPlan(skill, 'run', registry)).toThrow(/interactive inputs/);
    expect(() => buildSkillToolPlan(skill, 'run', registry, { destination: 'sk-abcdefghijklmnopqrstuvwxyz' })).toThrow(/credential material/);
    expect(buildSkillToolPlan(skill, 'run', registry, { destination: 'https://example.test/private' })[0]?.argumentsJson)
      .toBe('{"url":"https://example.test/private"}');
  });
});
