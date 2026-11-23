import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PIXEL_AGENT_PROTOCOL_VERSION,
  PythonAgentBridge,
} from '../src/main/services/pythonAgentBridge';

let bridge: PythonAgentBridge | null = null;
const tempDirs: string[] = [];

afterEach(async () => {
  if (bridge) {
    await bridge.dispose();
    bridge = null;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup race */
    }
  }
});

describe('Python Agent Service bridge (pixel-agent-v2)', () => {
  it('handshakes over stdio NDJSON, tracks ownership, plans turns, and keeps main-process authority', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-py-bridge-'));
    tempDirs.push(dir);
    const ownershipPath = join(dir, 'python-agent-owner.json');

    bridge = new PythonAgentBridge({ ownershipPath });
    const ping = await bridge.ping();
    expect(ping.protocol).toBe(PIXEL_AGENT_PROTOCOL_VERSION);
    expect(ping.authority).toBe('main-process-broker');
    expect(ping.pid).toBeGreaterThan(0);

    // Ownership file exists while child is alive and records matching pid.
    expect(existsSync(ownershipPath)).toBe(true);
    const owner = JSON.parse(readFileSync(ownershipPath, 'utf8')) as { pid: number; parentPid: number };
    expect(owner.pid).toBe(ping.pid);
    expect(owner.parentPid).toBe(process.pid);

    const plan = await bridge.planTurn({
      prompt: 'Check git status and recent commits',
      mode: 'agent',
      allowedTools: ['git_status', 'git_log', 'file_read'],
    });
    expect(plan.requiresMainProcessAuthorization).toBe(true);
    expect(plan.suggestedTools).toContain('git_status');

    const noise = await bridge.scoreMemory({ text: 'Can you check the build?' });
    expect(noise.keep).toBe(false);

    const durable = await bridge.scoreMemory({ text: 'I always use Vitest for TypeScript tests.' });
    expect(durable.keep).toBe(true);
    expect(durable.score).toBeGreaterThanOrEqual(0.65);

    await bridge.dispose();
    bridge = null;
    expect(existsSync(ownershipPath)).toBe(false);
  });

  it('quarantines corrupt ownership metadata into a .corrupt file without touching unrelated processes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-py-corrupt-'));
    tempDirs.push(dir);
    const ownershipPath = join(dir, 'python-agent-owner.json');
    writeFileSync(ownershipPath, '{not valid json', 'utf8');

    bridge = new PythonAgentBridge({ ownershipPath });
    const result = bridge.inspectAndCleanOwnership();
    expect(result.status).toBe('quarantined');
    expect(existsSync(ownershipPath)).toBe(false);
    expect(existsSync(`${ownershipPath}.corrupt`)).toBe(true);
  });
});
