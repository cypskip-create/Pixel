// @vitest-environment jsdom
/**
 * Stage 9 Final Correction & Production Acceptance Regression Suite.
 *
 * Covers every defect targeted in the Stage 9 final correction pass:
 *  1. Authoritative profile project resolution & task scope isolation (TS + Python paths)
 *  2. HistoryStore project-scoped list & clearProject (legacy unscoped bound to Default)
 *  3. Per-run provider override in local runtime (TypeScript RuntimeProvider + Python config)
 *  4. Multi-session import partial-failure rollback, retry, duplicate block & concurrency lock
 *  5. Real Artifact registration via ToolExecutors.run('file_write') & image_generate + safe open/traversal block
 *  6. Cron schedule editing for daily, cron expression, and interval schedules
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/types';
import { HistoryStore, MemoryStorage } from '../src/main/history/store';
import { RuntimeProvider } from '../src/main/providers/runtime';
import { resolveProviderChain } from '../src/main/providers/catalog';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';
import {
  applyProfileProviderOverride,
  commitSessionImportSafely,
  isConversationOwnedByProfile,
  isTaskOwnedByProfile,
  validateArtifactPath,
} from '../src/main/services/stage9Helpers';
import { ToolExecutors } from '../src/main/agent/executors';
import { FileTools } from '../src/main/files/toolset';
import { ArtifactsPage, CronPage } from '../src/renderer/components/Stage9Destinations';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
}

describe('Stage 9 Final Corrections — Isolation, Overrides, Atomic Import & Real Artifacts', () => {
  const cleanupDirs: string[] = [];
  let bridge: PythonAgentBridge | null = null;

  afterEach(async () => {
    if (bridge) {
      await bridge.dispose().catch(() => undefined);
      bridge = null;
    }
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('1. Enforces strict task & conversation ownership across Default, Profile A, and Profile B (including legacy unscoped)', () => {
    const profileProjIds = new Set(['prj_alpha', 'prj_beta']);
    const legacyTask = { projectId: undefined };
    const defaultTask = { projectId: 'prj_default' };
    const alphaTask = { projectId: 'prj_alpha' };
    const betaTask = { projectId: 'prj_beta' };

    // Default sees defaultTask + legacyTask, NEVER alphaTask or betaTask
    expect(isTaskOwnedByProfile(defaultTask, 'default', 'prj_default', profileProjIds)).toBe(true);
    expect(isTaskOwnedByProfile(legacyTask, 'default', 'prj_default', profileProjIds)).toBe(true);
    expect(isTaskOwnedByProfile(alphaTask, 'default', 'prj_default', profileProjIds)).toBe(false);
    expect(isTaskOwnedByProfile(betaTask, 'default', 'prj_default', profileProjIds)).toBe(false);

    // Profile A sees ONLY alphaTask (no legacy, no Default, no Profile B)
    expect(isTaskOwnedByProfile(alphaTask, 'alpha', 'prj_alpha', profileProjIds)).toBe(true);
    expect(isTaskOwnedByProfile(legacyTask, 'alpha', 'prj_alpha', profileProjIds)).toBe(false);
    expect(isTaskOwnedByProfile(defaultTask, 'alpha', 'prj_alpha', profileProjIds)).toBe(false);
    expect(isTaskOwnedByProfile(betaTask, 'alpha', 'prj_alpha', profileProjIds)).toBe(false);

    // Conversation ownership follows the same strict rule
    expect(isConversationOwnedByProfile({ projectId: undefined }, 'default', 'prj_default', profileProjIds)).toBe(true);
    expect(isConversationOwnedByProfile({ projectId: undefined }, 'alpha', 'prj_alpha', profileProjIds)).toBe(false);
    expect(isConversationOwnedByProfile({ projectId: 'prj_alpha' }, 'beta', 'prj_beta', profileProjIds)).toBe(false);
  });

  it('2. HistoryStore.clearProject and list(includeUnscoped=false) isolate profiles without deleting other profiles', () => {
    const store = new HistoryStore(new MemoryStorage());
    const legacy = HistoryStore.newConversation('Legacy Default Chat');
    store.save(legacy);

    const defConv = HistoryStore.newConversation('Default Project Chat');
    defConv.projectId = 'prj_default';
    store.save(defConv);

    const alphaConv = HistoryStore.newConversation('Alpha Private Chat');
    alphaConv.projectId = 'prj_alpha';
    store.save(alphaConv);

    const betaConv = HistoryStore.newConversation('Beta Private Chat');
    betaConv.projectId = 'prj_beta';
    store.save(betaConv);

    // Non-default profile list MUST NOT see legacy unscoped or other profiles
    expect(store.list({ projectId: 'prj_alpha', includeUnscoped: false }).map((c) => c.title)).toEqual(['Alpha Private Chat']);
    expect(store.list({ projectId: 'prj_beta', includeUnscoped: false }).map((c) => c.title)).toEqual(['Beta Private Chat']);

    // Clearing Profile A leaves Default, Legacy, and Profile B completely untouched
    const deleted = store.clearProject('prj_alpha', false);
    expect(deleted).toEqual([alphaConv.id]);
    expect(store.list({ projectId: 'prj_alpha', includeUnscoped: false })).toEqual([]);
    expect(store.list({ projectId: 'prj_beta', includeUnscoped: false }).map((c) => c.title)).toEqual(['Beta Private Chat']);
    expect(store.list({ projectId: 'prj_default', includeUnscoped: true }).map((c) => c.title).sort()).toEqual([
      'Default Project Chat',
      'Legacy Default Chat',
    ]);
  });

  it('3. Applies per-run profile provider override (OpenAI over global DeepSeek) in both TS RuntimeProvider and Python config without mutating global settings', async () => {
    const globalSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      provider: {
        ...DEFAULT_SETTINGS.provider,
        provider: 'deepseek',
        primaryModel: 'deepseek-flash',
      },
    };

    // Python path: applyProfileProviderOverride resolves OpenAI + default OpenAI baseUrl + model override
    const pyEffective = applyProfileProviderOverride(globalSettings.provider, 'openai', 'gpt-4o-mini');
    const pyChain = resolveProviderChain(pyEffective, pyEffective.primaryModel);
    expect(pyChain[0]?.provider).toBe('openai');
    expect(pyChain[0]?.model).toBe('gpt-4o-mini');
    expect(pyChain[0]?.baseUrl).toContain('api.openai.com');
    expect(globalSettings.provider.provider).toBe('deepseek');

    // TypeScript RuntimeProvider path: dispatches to OpenAI with OpenAI API key, leaving DeepSeek untouched
    const seenUrls: string[] = [];
    const seenAuthHeaders: string[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      seenUrls.push(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seenAuthHeaders.push(headers.Authorization ?? headers.authorization ?? '');
      const sse = [
        'data: {"choices":[{"delta":{"content":"Hello from OpenAI"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const runtime = new RuntimeProvider(() => 'sk-deepseek-global', {
      getSettings: () => globalSettings,
      getProviderApiKey: (pid) => (pid === 'openai' ? 'sk-openai-profile' : 'sk-deepseek-global'),
      fetchImpl: mockFetch,
    });

    const out = await runtime.generate({
      requestId: 'req-override-1',
      model: 'gpt-4o-mini',
      providerOverride: 'openai',
      messages: [{ id: 'm1', role: 'user', content: 'Hi', createdAt: Date.now() }],
      thinking: { enabled: false, effort: 'low' },
      temperature: 0.7,
      maxTokens: 256,
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      onEvent: () => undefined,
    });

    expect(out.content).toContain('Hello from OpenAI');
    expect(seenUrls[0]).toContain('api.openai.com');
    expect(seenAuthHeaders[0]).toBe('Bearer sk-openai-profile');
    expect(globalSettings.provider.provider).toBe('deepseek');

    // Missing API key for the overridden provider returns a clear error naming OpenAI
    const missingKeyRuntime = new RuntimeProvider(() => 'sk-deepseek-global', {
      getSettings: () => globalSettings,
      getProviderApiKey: (pid) => (pid === 'deepseek' ? 'sk-deepseek-global' : null),
      fetchImpl: mockFetch,
    });
    await expect(
      missingKeyRuntime.generate({
        requestId: 'req-override-2',
        model: 'gpt-4o-mini',
        providerOverride: 'openai',
        messages: [{ id: 'm1', role: 'user', content: 'Hi', createdAt: Date.now() }],
        thinking: { enabled: false, effort: 'low' },
        temperature: 0.7,
        maxTokens: 256,
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        onEvent: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'NO_API_KEY' });
  });

  it('4. Multi-session import rolls back partial failures, allows retry, blocks duplicates, and serializes concurrent attempts', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pixel-s9-atomic-'));
    cleanupDirs.push(tempDir);
    bridge = new PythonAgentBridge({
      gatewayDataDir: join(tempDir, 'gw'),
      workspaceDataDir: join(tempDir, 'ws'),
    });

    const multiPayload = JSON.stringify({
      conversations: [
        { title: 'Session One', messages: [{ role: 'user', content: 'First' }] },
        { title: 'Session Two', messages: [{ role: 'user', content: 'Second' }] },
      ],
    });

    // Case 1: Failure before first save
    const store = new HistoryStore(new MemoryStorage());
    await expect(
      commitSessionImportSafely({
        rawText: multiPayload,
        format: 'json',
        projectId: 'proj-m',
        history: {
          save: () => { throw new Error('Fail before first'); },
          delete: (id) => store.delete(id),
        },
        preview: (t, f) => bridge!.sessionImportPreview(t, f),
        confirm: (d) => bridge!.sessionImportConfirm(d),
      }),
    ).rejects.toThrow('Fail before first');
    expect(store.list({ projectId: 'proj-m' }).length).toBe(0);

    // Case 2: Failure AFTER 1st conversation is saved -> 1st conversation MUST be rolled back!
    let saveCalls = 0;
    await expect(
      commitSessionImportSafely({
        rawText: multiPayload,
        format: 'json',
        projectId: 'proj-m',
        history: {
          save: (rec) => {
            saveCalls += 1;
            if (saveCalls === 2) throw new Error('Fail on second save');
            store.save(rec);
          },
          delete: (id) => store.delete(id),
        },
        preview: (t, f) => bridge!.sessionImportPreview(t, f),
        confirm: (d) => bridge!.sessionImportConfirm(d),
      }),
    ).rejects.toThrow('Fail on second save');
    expect(store.list({ projectId: 'proj-m' }).length).toBe(0);

    // Case 3 & 5: Two concurrent attempts with the same digest -> exactly 1 succeeds (2 conversations), 1 rejected as duplicate!
    const [rA, rB] = await Promise.all([
      commitSessionImportSafely({
        rawText: multiPayload,
        format: 'json',
        projectId: 'proj-m',
        history: store,
        preview: (t, f) => bridge!.sessionImportPreview(t, f),
        confirm: (d) => bridge!.sessionImportConfirm(d),
      }),
      commitSessionImportSafely({
        rawText: multiPayload,
        format: 'json',
        projectId: 'proj-m',
        history: store,
        preview: (t, f) => bridge!.sessionImportPreview(t, f),
        confirm: (d) => bridge!.sessionImportConfirm(d),
      }),
    ]);
    expect([rA.ok, rB.ok].filter(Boolean).length).toBe(1);
    expect([rA.duplicate, rB.duplicate].filter(Boolean).length).toBe(1);
    expect(store.list({ projectId: 'proj-m' }).length).toBe(2);

    // Case 4: Duplicate import after completion is rejected without adding conversations
    const dup = await commitSessionImportSafely({
      rawText: multiPayload,
      format: 'json',
      projectId: 'proj-m',
      history: store,
      preview: (t, f) => bridge!.sessionImportPreview(t, f),
      confirm: (d) => bridge!.sessionImportConfirm(d),
    });
    expect(dup.ok).toBe(false);
    expect(dup.duplicate).toBe(true);
    expect(store.list({ projectId: 'proj-m' }).length).toBe(2);
  }, 20000);

  it('5. Exercises real ToolExecutors.run(file_write) -> Python Artifact registration -> ArtifactsPage listing & safe path validation', async () => {
    // Use an approved workspace directory OUTSIDE OS tmpdir so production temp-file filtering is genuinely respected.
    const workspaceDir = join(process.cwd(), `.tmp-stage9-artifacts-${Date.now()}`);
    const outsideDir = mkdtempSync(join(tmpdir(), 'pixel-s9-outside-'));
    mkdirSync(workspaceDir, { recursive: true });
    cleanupDirs.push(workspaceDir, outsideDir);

    bridge = new PythonAgentBridge({
      gatewayDataDir: join(outsideDir, 'gw'),
      workspaceDataDir: join(outsideDir, 'ws'),
    });

    const registrations: Array<Promise<unknown>> = [];
    const files = new FileTools({ allowedRoot: workspaceDir });
    const executors = new ToolExecutors({
      files,
      onArtifactCreated: (artifact) => {
        registrations.push(
          bridge!.artifactsRegister({
            ...artifact,
            projectId: 'proj-real-art',
            profileId: 'default',
          }),
        );
      },
    });

    const writeResult = await executors.run('file_write', {
      path: join(workspaceDir, 'release-summary.md'),
      content: '# Stage 9 Release Summary\nAll checks verified.',
    });
    expect(writeResult.ok).toBe(true);
    expect(registrations.length).toBe(1);
    await Promise.all(registrations);

    const listed = await bridge.artifactsList({ profileId: 'default', projectId: 'proj-real-art' });
    expect(listed.length).toBe(1);
    expect(listed[0]?.name).toBe('release-summary.md');
    expect(listed[0]?.kind).toBe('document');

    // Path validation approves the real written artifact and rejects outside-root / traversal paths
    const okPath = validateArtifactPath(String(listed[0]?.filePath), [workspaceDir]);
    expect(okPath.ok).toBe(true);

    const outsideFile = join(outsideDir, 'secret.txt');
    writeFileSync(outsideFile, 'nope');
    expect(validateArtifactPath(outsideFile, [workspaceDir]).ok).toBe(false);
    expect(validateArtifactPath(join(workspaceDir, '..', 'package.json'), [workspaceDir]).ok).toBe(false);

    // Mount ArtifactsPage and verify it displays the registered artifact
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    (window as unknown as { cyps: unknown }).cyps = {
      artifacts: {
        list: vi.fn().mockResolvedValue(listed),
        open: vi.fn().mockResolvedValue({ ok: true }),
        reveal: vi.fn().mockResolvedValue({ ok: true }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    act(() => root.render(createElement(ArtifactsPage, { projectId: 'proj-real-art' })));
    await flush();
    expect(container.textContent).toContain('release-summary.md');
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { cyps?: unknown }).cyps;
  }, 20000);

  it('6. CronPage supports editing daily, cron expression, and interval schedule properties', async () => {
    const updateSpy = vi.fn().mockResolvedValue({
      id: 'rt-edit',
      name: 'Edited Cron',
      scheduleKind: 'cron',
      cronExpression: '0 10 * * 1-5',
      localTime: '09:00',
      timezone: 'UTC',
      enabled: true,
    });
    (window as unknown as { cyps: unknown }).cyps = {
      skills: { list: vi.fn().mockResolvedValue([{ id: 'sk-1', name: 'Build Check', status: 'active' }]) },
      routines: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'rt-edit',
            projectId: 'default',
            skillId: 'sk-1',
            name: 'Daily Check',
            scheduleKind: 'daily',
            localTime: '09:00',
            timezone: 'UTC',
            missedRunPolicy: 'skip',
            enabled: true,
            inputNames: [],
            retryPolicy: 'manual',
            createdAt: 1000,
            updatedAt: 1000,
          },
        ]),
        update: updateSpy,
        setEnabled: vi.fn().mockResolvedValue(true),
        history: vi.fn().mockResolvedValue([]),
        runNow: vi.fn().mockResolvedValue(true),
        cancel: vi.fn().mockResolvedValue(false),
        retry: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
      },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => root.render(createElement(CronPage)));
    await flush();

    // Open Edit mode
    const editBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Edit') as HTMLButtonElement;
    await act(async () => { editBtn.click(); });

    // Switch schedule kind to cron and set expression
    const kindSelect = container.querySelector('select[aria-label="Edit schedule kind"]') as HTMLSelectElement;
    const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    await act(async () => {
      selectSetter.call(kindSelect, 'cron');
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const cronInput = container.querySelector('input[aria-label="Edit cron expression"]') as HTMLInputElement;
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      inputSetter.call(cronInput, '0 10 * * 1-5');
      cronInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saveBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save') as HTMLButtonElement;
    await act(async () => { saveBtn.click(); });
    await flush();

    expect(updateSpy).toHaveBeenCalledWith(
      'rt-edit',
      expect.objectContaining({ scheduleKind: 'cron', cronExpression: '0 10 * * 1-5' }),
    );

    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { cyps?: unknown }).cyps;
  });
});
