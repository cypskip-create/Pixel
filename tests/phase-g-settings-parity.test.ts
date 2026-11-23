import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/types';
import { SpecialistCoordinator, planDelegation } from '../src/main/agents/coordinator';
import { ToolRegistry } from '../src/main/agent/tools';

interface ParityEntry {
  id: string;
  config_key: string;
  gap_classification: string;
  implementation_files: string;
  test_reference: string;
  acceptance_status: string;
}

interface ParityMap {
  hermes_upstream_commit: string;
  total_entries: number;
  counts_by_classification: Record<string, number>;
  entries: ParityEntry[];
}

describe('Phase G: Settings Parity Acceptance & Automated Inventory Reconciliation', () => {
  it('validates defaults, valid updates, out-of-range clamping, and persistence for agent.maxTurns and agent.maxConcurrentSpecialists', () => {
    expect(DEFAULT_SETTINGS.agent.maxTurns).toBe(12);
    expect(DEFAULT_SETTINGS.agent.maxConcurrentSpecialists).toBe(3);

    const updated = mergeSettings({
      agent: { runtimeEngine: 'python', maxTurns: 24, maxConcurrentSpecialists: 2 },
    });
    expect(updated.agent.runtimeEngine).toBe('python');
    expect(updated.agent.maxTurns).toBe(24);
    expect(updated.agent.maxConcurrentSpecialists).toBe(2);

    // Out-of-range values clamp safely rather than throwing or allowing unbounded values.
    const clampedHigh = mergeSettings({
      agent: { runtimeEngine: 'typescript', maxTurns: 999, maxConcurrentSpecialists: 99 },
    });
    expect(clampedHigh.agent.maxTurns).toBe(40);
    expect(clampedHigh.agent.maxConcurrentSpecialists).toBe(3);

    const clampedLow = mergeSettings({
      agent: { runtimeEngine: 'typescript', maxTurns: -5, maxConcurrentSpecialists: 0 },
    });
    expect(clampedLow.agent.maxTurns).toBe(4);
    expect(clampedLow.agent.maxConcurrentSpecialists).toBe(1);

    // Round-trip JSON serialization simulates restart persistence.
    const reloaded = mergeSettings(JSON.parse(JSON.stringify(updated)));
    expect(reloaded.agent).toEqual(updated.agent);
  });

  it('applies agent.maxConcurrentSpecialists to SpecialistCoordinator.delegateParallel', async () => {
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

    const settings = mergeSettings({ agent: { runtimeEngine: 'typescript', maxTurns: 12, maxConcurrentSpecialists: 1 } });
    let active = 0;
    let peak = 0;
    const coordinator = new SpecialistCoordinator({
      registry,
      isStopped: () => false,
      invokeTool: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
        return { ok: true, content: 'ok' };
      },
    });

    const p1 = planDelegation({ specialist: 'research', objective: 'A', mode: 'agent', projectId: 'default' }, registry);
    const p2 = planDelegation({ specialist: 'systems', objective: 'B', mode: 'agent', projectId: 'default' }, registry);

    const report = await coordinator.delegateParallel(
      [
        { plan: p1, work: (s) => (s === 0 ? { tool: 'get_current_time', args: {} } : null) },
        { plan: p2, work: (s) => (s === 0 ? { tool: 'get_current_time', args: {} } : null) },
      ],
      { maxConcurrency: settings.agent.maxConcurrentSpecialists },
    );
    expect(report.status).toBe('completed');
    expect(peak).toBe(1);
    expect(report.maxConcurrencyUsed).toBe(1);
  });

  it('reconciles docs/parity/HERMES_SETTINGS_SOURCE_MAP.json against real source and test files', () => {
    const mapPath = join(process.cwd(), 'docs', 'parity', 'HERMES_SETTINGS_SOURCE_MAP.json');
    expect(existsSync(mapPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(mapPath, 'utf8')) as ParityMap;

    expect(parsed.hermes_upstream_commit).toBe('0f602c5f6f18615632535251d62a2db74ce93b69');
    expect(parsed.entries.length).toBe(parsed.total_entries);
    expect(parsed.total_entries).toBeGreaterThanOrEqual(150);

    const sumCounts = Object.values(parsed.counts_by_classification).reduce((a, b) => a + b, 0);
    expect(sumCounts).toBe(parsed.total_entries);

    // Every "Implemented and verified" entry MUST reference real existing implementation and test files.
    const verified = parsed.entries.filter((e) => e.gap_classification === 'Implemented and verified');
    expect(verified.length).toBeGreaterThan(25);
    for (const entry of verified) {
      expect(entry.acceptance_status).toBe('Verified');
      for (const file of entry.implementation_files.split(',').map((s) => s.trim()).filter(Boolean)) {
        expect(existsSync(join(process.cwd(), file)), `Missing impl file ${file} for ${entry.id}`).toBe(true);
      }
      for (const testFile of entry.test_reference.split(',').map((s) => s.trim()).filter(Boolean)) {
        expect(existsSync(join(process.cwd(), testFile)), `Missing test file ${testFile} for ${entry.id}`).toBe(true);
      }
    }
  });
});
