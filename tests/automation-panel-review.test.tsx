/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CypsBridge, SkillRecord } from '../src/shared/types';
import { AutomationPanel } from '../src/renderer/components/AutomationPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  delete (window as Window & { cyps?: unknown }).cyps;
});

const draft: SkillRecord = {
  schemaVersion: 1,
  id: 'skill_draft1',
  projectId: 'project_a',
  name: 'Review task',
  purpose: 'Inspect the selected page.',
  triggers: [],
  inputs: [{ name: 'step_1_url', description: 'Page URL', required: true }],
  requiredTools: ['browser_navigate'],
  steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_navigate', action: 'browser_navigate', params: { url: '${input.step_1_url}' }, expectation: { reobserveBeforeReplay: true }, approvalRequired: true }],
  decisionBranches: [],
  verificationRules: ['Check the current page.'],
  failureHandling: ['Stop if the page cannot be verified.'],
  approvalRequirements: ['Use current Pixel permissions.'],
  status: 'draft',
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

function mount(skill = draft): {
  element: HTMLDivElement;
  createDraft: ReturnType<typeof vi.fn>;
  runSkill: ReturnType<typeof vi.fn>;
  createRoutine: ReturnType<typeof vi.fn>;
} {
  host = document.createElement('div');
  document.body.append(host);
  const revised = { ...skill, id: 'skill_draft2', version: skill.version + 1, purpose: 'Inspect the page after the user reviews it.' };
  const createDraft = vi.fn(async () => revised);
  const runSkill = vi.fn(async () => ({ id: 'task_run1', title: 'Run reviewed skill', status: 'completed' as const, steps: [], createdAt: 2 }));
  const createRoutine = vi.fn(async (input: { skillId: string; inputValues: Record<string, string> }) => ({
    id: 'routine_1', projectId: 'project_a', skillId: input.skillId, name: 'Daily status check',
    localTime: '09:00', timezone: 'UTC', enabled: true, inputNames: Object.keys(input.inputValues),
    retryPolicy: 'manual' as const, missedRunPolicy: 'skip' as const, createdAt: 3, updatedAt: 3,
  }));
  const bridge = {
    skills: { list: vi.fn(async () => [skill]), run: runSkill, createDraft, activate: vi.fn(async (id: string) => ({ ...skill, id, status: 'active' as const })), delete: vi.fn(async () => true) },
    routines: { list: vi.fn(async () => []), create: createRoutine },
  } as unknown as CypsBridge;
  Object.defineProperty(window, 'cyps', { configurable: true, value: bridge });
  root = createRoot(host);
  act(() => root?.render(<AutomationPanel onBack={vi.fn()} />));
  return { element: host, createDraft, runSkill, createRoutine };
}

describe('AutomationPanel skill draft review', () => {
  it('allows reviewed edits to be saved as a new immutable draft version before activation', async () => {
    const { element, createDraft } = mount();
    await act(async () => { await Promise.resolve(); });
    act(() => [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Review')?.click());
    const editor = element.querySelector<HTMLTextAreaElement>('[aria-label="Review skill definition JSON"]');
    expect(editor).not.toBeNull();
    expect(editor?.value).not.toContain('skill_draft1');

    const updated = { ...JSON.parse(editor?.value ?? '{}'), purpose: 'Inspect the page after the user reviews it.' };
    act(() => {
      if (!editor) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(editor, JSON.stringify(updated, null, 2));
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Save revised version')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ purpose: updated.purpose }));
    expect(element.textContent).toContain('Review draft: Review task');
    expect(element.querySelector<HTMLTextAreaElement>('[aria-label="Review skill definition JSON"]')?.value).toContain(updated.purpose);
    expect(element.querySelector<HTMLButtonElement>('button')?.textContent).not.toContain('Approve and activate');
    expect(element.textContent).toContain('Approve and activate');
  });

  it('collects one-time declared inputs and invokes an active skill through the bridge', async () => {
    const active = { ...draft, id: 'skill_active1', status: 'active' as const };
    const { element, runSkill } = mount(active);
    await act(async () => { await Promise.resolve(); });
    act(() => [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Run once')?.click());

    const input = element.querySelector<HTMLInputElement>('form input');
    expect(input).not.toBeNull();
    act(() => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'https://example.test/page');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = element.querySelector<HTMLFormElement>('form[aria-label="Run Review task once"]');
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runSkill).toHaveBeenCalledWith('skill_active1', { step_1_url: 'https://example.test/page' });
    expect(element.textContent).toContain('Skill run completed');
  });

  it('collects declared non-credential values for a routine without rendering saved values', async () => {
    const active = { ...draft, id: 'skill_active_routine', status: 'active' as const };
    const { element, createRoutine } = mount(active);
    await act(async () => { await Promise.resolve(); });

    const input = element.querySelector<HTMLInputElement>('[aria-label="Routine input step_1_url"]');
    expect(input).not.toBeNull();
    act(() => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'https://example.test/daily');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Schedule daily')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createRoutine).toHaveBeenCalledWith(expect.objectContaining({
      skillId: 'skill_active_routine',
      inputValues: { step_1_url: 'https://example.test/daily' },
    }));
    expect(element.textContent).toContain('Saved inputs: step_1_url');
    expect(element.textContent).not.toContain('https://example.test/daily');
  });
});
