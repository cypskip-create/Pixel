import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../src/shared/types';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import { SkillDefinitionSchema } from '../src/main/skills/schema';
import { draftSkillFromTask } from '../src/main/skills/recording';

const registry = new ToolRegistry(BUILTIN_TOOLS);

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task_record_1',
    title: 'Do something private with customer@example.test',
    status: 'completed',
    projectId: 'project_a',
    steps: [
      { id: 's1', title: 'Open a page', status: 'verified', toolName: 'browser_navigate', args: { url: 'https://private.example/path?q=secret' } },
      { id: 's2', title: 'Inspect page', status: 'done', toolName: 'browser_inspect', args: {} },
    ],
    createdAt: 1,
    ...overrides,
  };
}

describe('recorded task skill drafts', () => {
  it('creates a reviewable procedure without copying string arguments or task text', () => {
    const draft = draftSkillFromTask(task(), registry);
    const validated = SkillDefinitionSchema.parse({ ...draft, id: 'draft_1', projectId: 'project_a', status: 'draft', version: 1, createdAt: 1, updatedAt: 1 });
    expect(validated.steps[0]?.params).toEqual({ url: '${input.step_1_url}' });
    expect(validated.inputs).toEqual([{ name: 'step_1_url', description: 'Value for parameter “url” in step 1. Pixel did not copy the value from task history.', required: true }]);
    expect(validated.steps.every((step) => step.approvalRequired)).toBe(true);
    expect(JSON.stringify(draft)).not.toContain('private.example');
    expect(JSON.stringify(draft)).not.toContain('customer@example.test');
  });

  it('requires a completed verified task and refuses withheld or secret fields', () => {
    expect(() => draftSkillFromTask(task({ status: 'failed' }), registry)).toThrow(/completed task/);
    expect(() => draftSkillFromTask(task({ steps: [{ id: 's1', title: 'Failed', status: 'failed', toolName: 'browser_navigate', args: {} }] }), registry)).toThrow(/did not complete/);
    expect(() => draftSkillFromTask(task({ steps: [{ id: 's1', title: 'Secret', status: 'done', toolName: 'browser_type', args: { password: '[redacted]' } }] }), registry)).toThrow(/withheld value/);
    expect(() => draftSkillFromTask(task({ steps: [{ id: 's1', title: 'Unsupported', status: 'done', toolName: 'delegate_to_specialist', args: {} }] }), registry)).toThrow(/not supported/);
  });

  it('does not record a task that still needs verification or exceeds the capture bound', () => {
    expect(() => draftSkillFromTask(task({ reobserveRequired: true }), registry)).toThrow(/completed task/);
    expect(() => draftSkillFromTask(task({ steps: Array.from({ length: 41 }, (_, index) => ({ id: String(index), title: 'Step', status: 'done' as const, toolName: 'browser_inspect', args: {} })) }), registry)).toThrow(/40-step/);
  });
});
