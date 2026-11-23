import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROVIDER_MODEL_CATALOG } from '@shared/types';
import {
  applyStreamEventToSlices,
  beginSessionTurn,
  bindSessionRequest,
  createInitialSessionStore,
  getSessionSlice,
} from '../src/renderer/lib/sessionSlices';
import {
  listWorkspaceDir,
  readWorkspaceFile,
} from '../src/main/services/workspaceFs';
import {
  TerminalService,
  type TerminalExitEvent,
  type TerminalOutputEvent,
} from '../src/main/services/terminalService';
import { ToolRegistry } from '../src/main/agent/tools';
import { ToolExecutors } from '../src/main/agent/executors';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Stage 3 Completion + Stage 4 Advanced Process Tools (Functional End-to-End)', () => {
  it('isolates two overlapping concurrent live streams across Pane A and Pane B with zero cross-contamination', () => {
    let store = createInitialSessionStore();
    store = beginSessionTurn(store, 'pane-a', {
      userMessage: { id: 'u-a', role: 'user', content: 'Question A', createdAt: 1 },
      conversationId: 'conv-a',
      model: 'deepseek-flash',
      provider: 'deepseek',
    });
    store = bindSessionRequest(store, 'pane-a', 'req-a', 'conv-a');

    store = beginSessionTurn(store, 'pane-b', {
      userMessage: { id: 'u-b', role: 'user', content: 'Question B', createdAt: 2 },
      conversationId: 'conv-b',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
    });
    store = bindSessionRequest(store, 'pane-b', 'req-b', 'conv-b');

    // Interleaved streaming events from both concurrent turns.
    store = applyStreamEventToSlices(store, { type: 'text', requestId: 'req-a', delta: 'Alpha ' }).state;
    store = applyStreamEventToSlices(store, { type: 'text', requestId: 'req-b', delta: 'Beta ' }).state;
    store = applyStreamEventToSlices(store, { type: 'reasoning', requestId: 'req-a', delta: 'Think-A' }).state;
    store = applyStreamEventToSlices(store, { type: 'text', requestId: 'req-b', delta: 'done!' }).state;
    store = applyStreamEventToSlices(store, { type: 'done', requestId: 'req-b', finishReason: 'stop' }).state;

    // Pane B finished while Pane A is still streaming!
    expect(getSessionSlice(store, 'pane-b').streaming).toBe(false);
    expect(getSessionSlice(store, 'pane-b').messages.at(-1)?.content).toBe('Beta done!');
    expect(getSessionSlice(store, 'pane-a').streaming).toBe(true);
    expect(getSessionSlice(store, 'pane-a').content).toBe('Alpha ');
    expect(getSessionSlice(store, 'pane-a').reasoning).toBe('Think-A');

    store = applyStreamEventToSlices(store, { type: 'text', requestId: 'req-a', delta: 'complete.' }).state;
    store = applyStreamEventToSlices(store, { type: 'done', requestId: 'req-a', finishReason: 'stop' }).state;

    expect(getSessionSlice(store, 'pane-a').streaming).toBe(false);
    expect(getSessionSlice(store, 'pane-a').messages.at(-1)?.content).toBe('Alpha complete.');
    expect(getSessionSlice(store, 'pane-b').messages.map((m) => m.content)).toEqual(['Question B', 'Beta done!']);
  });

  it('browses real project directories, blocks traversal & secret files, and rejects binary previews', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-wfs-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'index.ts'), 'export const hello = "world";\n', 'utf8');
    writeFileSync(join(root, '.env'), 'SECRET_KEY=supersecret\n', 'utf8');
    writeFileSync(join(root, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const rootList = listWorkspaceDir(root, '');
    expect(rootList.ok).toBe(true);
    expect(rootList.entries.some((e) => e.name === 'src' && e.kind === 'dir')).toBe(true);
    expect(rootList.entries.some((e) => e.name === '.env')).toBe(false); // secret hidden

    const srcList = listWorkspaceDir(root, 'src');
    expect(srcList.ok).toBe(true);
    expect(srcList.entries.map((e) => e.relativePath)).toEqual(['src/index.ts']);

    const readOk = readWorkspaceFile(root, 'src/index.ts');
    expect(readOk.ok).toBe(true);
    expect(readOk.content).toContain('hello = "world"');

    const traversal = readWorkspaceFile(root, '../../etc/passwd');
    expect(traversal.ok).toBe(false);

    const secretRead = readWorkspaceFile(root, '.env');
    expect(secretRead.ok).toBe(false);

    const binRead = readWorkspaceFile(root, 'binary.bin');
    expect(binRead.ok).toBe(false);
    expect(binRead.binary).toBe(true);
  });

  it('executes real processes with stdout streaming, exit codes, authorization denial, Emergency Stop, and cancellation', async () => {
    const outputs: TerminalOutputEvent[] = [];
    const exits: TerminalExitEvent[] = [];
    let emergencyStopped = false;
    let allowCommand = true;

    const terminal = new TerminalService({
      defaultCwd: process.cwd(),
      isEmergencyStopped: () => emergencyStopped,
      authorize: async () => ({ allowed: allowCommand, reason: allowCommand ? undefined : 'Denied by policy' }),
      onOutput: (evt) => outputs.push(evt),
      onExit: (evt) => exits.push(evt),
    });

    // 1. Denied command must not run.
    allowCommand = false;
    const denied = await terminal.run('echo should-not-run');
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('Denied');

    // 2. Approved real command runs and streams stdout + exit code 0.
    allowCommand = true;
    const started = await terminal.run('Write-Output "PIXEL_TERM_OK"');
    expect(started.ok).toBe(true);
    expect(started.session?.id).toBeTruthy();

    await new Promise<void>((resolve) => {
      const check = () => {
        if (exits.some((e) => e.sessionId === started.session!.id)) resolve();
        else setTimeout(check, 40);
      };
      check();
    });

    const finished = terminal.get(started.session!.id);
    expect(finished?.status).toBe('completed');
    expect(finished?.exitCode).toBe(0);
    expect(finished?.output).toContain('PIXEL_TERM_OK');
    expect(outputs.some((o) => o.chunk.includes('PIXEL_TERM_OK'))).toBe(true);

    // 3. Long-running process is cancelled cleanly via killAll() (Emergency Stop).
    const longRun = await terminal.run('Start-Sleep -Seconds 20');
    expect(longRun.ok).toBe(true);
    const killed = terminal.killAll();
    expect(killed).toBe(1);
    expect(terminal.get(longRun.session!.id)?.status).toBe('cancelled');

    // 4. Emergency Stop active blocks new commands.
    emergencyStopped = true;
    const blocked = await terminal.run('Write-Output "blocked"');
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('Emergency Stop');
  }, 15_000);

  it('registers and executes Stage 4 process_start, process_poll, process_list, and process_kill tools', async () => {
    const registry = new ToolRegistry();
    expect(registry.get('process_start')?.requiresApproval).toBe(true);
    expect(registry.get('process_poll')?.requiresApproval).toBe(false);
    expect(registry.get('process_kill')?.requiresApproval).toBe(true);
    expect(registry.get('process_list')?.requiresApproval).toBe(false);

    const terminal = new TerminalService({ defaultCwd: process.cwd() });
    const executors = new ToolExecutors({ terminal });

    const startRes = await executors.run('process_start', { command: 'Write-Output "STAGE4_TOOL_OK"' });
    expect(startRes.ok).toBe(true);
    const sessionId = (startRes.detail as { id: string }).id;

    // Poll until the spawned PowerShell process finishes (bounded wait, no fixed sleep race).
    let pollRes = await executors.run('process_poll', { sessionId });
    const deadline = Date.now() + 8_000;
    while (pollRes.ok && pollRes.content.includes('status=running') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 80));
      pollRes = await executors.run('process_poll', { sessionId });
    }
    expect(pollRes.ok).toBe(true);
    expect(pollRes.content).toContain('STAGE4_TOOL_OK');

    const listRes = await executors.run('process_list', {});
    expect(listRes.ok).toBe(true);
    expect(listRes.content).toContain(sessionId);

    terminal.killAll();
  }, 15_000);

  it('provides verified per-model capability metadata rather than provider-name guesses', () => {
    const flash = PROVIDER_MODEL_CATALOG.find((m) => m.id === 'deepseek-flash');
    const pro = PROVIDER_MODEL_CATALOG.find((m) => m.id === 'deepseek-v4-pro');
    const gpt4o = PROVIDER_MODEL_CATALOG.find((m) => m.id === 'gpt-4o');
    const o3Mini = PROVIDER_MODEL_CATALOG.find((m) => m.id === 'o3-mini');
    expect(flash?.vision).toBe(true);
    expect(pro?.vision).toBe(false);
    expect(gpt4o?.thinking).toBe(false);
    expect(o3Mini?.thinking).toBe(true);
  });
});
