import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/types';
import { Database } from '../src/main/data/database';
import { MemoryStore } from '../src/main/memory/store';
import { SessionMemorySnapshotManager } from '../src/main/memory/snapshot';
import { planDelegation } from '../src/main/agents/coordinator';
import { ToolRegistry } from '../src/main/agent/tools';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Stage 1 Hermes Source Integration: Runtime, Memory, Delegation, Compression & Display Parity', () => {
  it('validates defaults, valid updates, clamping, and restart persistence for all Stage 1A + 1B settings', () => {
    expect(DEFAULT_SETTINGS.agent).toMatchObject({
      runtimeEngine: 'python',
      maxTurns: 12,
      maxConcurrentSpecialists: 3,
      delegationMaxIterations: 12,
      delegationChildTimeoutSec: 180,
      apiMaxRetries: 2,
      memoryCharLimit: 900,
      userProfileCharLimit: 700,
      compressionEnabled: true,
      compressionThreshold: 0.75,
      compressionProtectLastN: 6,
      defaultTimezone: '',
    });
    expect(DEFAULT_SETTINGS.display).toMatchObject({
      uiScale: 100,
      chatTextScale: 100,
      sessionDensity: 'comfortable',
      reasoningCollapsed: true,
      hideCodeDiffs: false,
      muteSounds: false,
    });

    const updated = mergeSettings({
      agent: {
        delegationMaxIterations: 20,
        delegationChildTimeoutSec: 300,
        apiMaxRetries: 4,
        memoryCharLimit: 1800,
        userProfileCharLimit: 1200,
        compressionEnabled: false,
        compressionThreshold: 0.85,
        compressionProtectLastN: 10,
        defaultTimezone: 'America/New_York',
      },
      display: {
        uiScale: 110,
        chatTextScale: 115,
        sessionDensity: 'compact',
        reasoningCollapsed: false,
        hideCodeDiffs: true,
        muteSounds: true,
      },
    });
    expect(updated.agent.delegationMaxIterations).toBe(20);
    expect(updated.agent.compressionThreshold).toBe(0.85);
    expect(updated.agent.defaultTimezone).toBe('America/New_York');
    expect(updated.display.sessionDensity).toBe('compact');
    expect(updated.display.hideCodeDiffs).toBe(true);

    // Clamp extreme out-of-range inputs safely.
    const clamped = mergeSettings({
      agent: {
        delegationMaxIterations: 999,
        delegationChildTimeoutSec: 1,
        apiMaxRetries: 99,
        memoryCharLimit: 50,
        userProfileCharLimit: 99999,
        compressionThreshold: 0.01,
        compressionProtectLastN: 100,
      },
      display: {
        uiScale: 500,
        chatTextScale: 10,
      },
    });
    expect(clamped.agent.delegationMaxIterations).toBe(30);
    expect(clamped.agent.delegationChildTimeoutSec).toBe(15);
    expect(clamped.agent.apiMaxRetries).toBe(5);
    expect(clamped.agent.memoryCharLimit).toBe(300);
    expect(clamped.agent.userProfileCharLimit).toBe(3000);
    expect(clamped.agent.compressionThreshold).toBe(0.4);
    expect(clamped.agent.compressionProtectLastN).toBe(20);
    expect(clamped.display.uiScale).toBe(125);
    expect(clamped.display.chatTextScale).toBe(85);

    // Simulate restart persistence.
    const reloaded = mergeSettings(JSON.parse(JSON.stringify(updated)));
    expect(reloaded.agent).toEqual(updated.agent);
    expect(reloaded.display).toEqual(updated.display);
  });

  it('applies memoryCharLimit and userProfileCharLimit dynamically in SessionMemorySnapshotManager', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-stage1-mem-'));
    tempDirs.push(dir);
    const db = new Database({ path: join(dir, 'pixel.sqlite') });
    db.migrate();
    const store = new MemoryStore(db);
    const proj = store.getActiveProject();
    store.save({ projectId: proj, kind: 'preference', content: 'A'.repeat(240), confidence: 'user_approved', source: 'user' });
    store.save({ projectId: proj, kind: 'preference', content: 'B'.repeat(240), confidence: 'user_approved', source: 'user' });

    const snapshots = new SessionMemorySnapshotManager(store, { userProfileChars: 350 });
    const small = snapshots.getOrCreateSnapshot('conv-1', proj);
    expect(small.frozenMemoryIds.length).toBe(1);

    snapshots.updateBudgets({ userProfileChars: 1200 });
    const expanded = snapshots.getOrCreateSnapshot('conv-1', proj);
    expect(expanded.frozenMemoryIds.length).toBe(2);
    db.close();
  });

  it('applies delegationMaxIterations and delegationChildTimeoutSec in planDelegation', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'get_current_time',
      description: 'Read current time',
      category: 'system',
      risk: 'low',
      requiresApproval: false,
      changesState: false,
      parameters: { type: 'object', properties: {} },
    });

    const plan = planDelegation({
      specialist: 'research',
      objective: 'Verify custom budgets',
      mode: 'agent',
      projectId: 'default',
      maxIterationsOverride: 22,
      childTimeoutSecOverride: 45,
    }, registry);
    expect(plan.limits.maxSteps).toBe(22);
    expect(plan.limits.timeoutMs).toBe(45_000);
  });

  it('honors compressionEnabled and compressionThreshold in Python pixel_agent.compressor', () => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const script = `
import json
from pixel_agent.compressor import compress_messages
msgs = [{"role": "system", "content": "sys"}] + [
    {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i} " + ("x" * 200)}
    for i in range(16)
]
out_off, stats_off = compress_messages(msgs, 400, enabled=False)
out_on, stats_on = compress_messages(msgs, 800, enabled=True, threshold_ratio=0.5, keep_recent=4)
print(json.dumps({"off_len": len(out_off), "orig_len": len(msgs), "on_compressed": stats_on["compressedMiddle"]}))
`;
    const res = spawnSync(py, ['-c', script], {
      cwd: join(process.cwd(), 'python'),
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout.trim()) as { off_len: number; orig_len: number; on_compressed: number };
    expect(parsed.off_len).toBe(parsed.orig_len);
    expect(parsed.on_compressed).toBeGreaterThan(0);
  });
});
