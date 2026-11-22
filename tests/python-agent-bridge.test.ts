import { afterEach, describe, expect, it } from 'vitest';
import { PIXEL_AGENT_PROTOCOL_VERSION, PythonAgentBridge } from '../src/main/services/pythonAgentBridge';

let bridge: PythonAgentBridge | null = null;

afterEach(async () => {
  if (bridge) {
    await bridge.dispose();
    bridge = null;
  }
});

describe('Python Agent Service bridge (pixel-agent-v1)', () => {
  it('handshakes over stdio JSONL, plans advisory turns, and scores memory without execution authority', async () => {
    bridge = new PythonAgentBridge();
    const ping = await bridge.ping();
    expect(ping.protocol).toBe(PIXEL_AGENT_PROTOCOL_VERSION);
    expect(ping.authority).toBe('advisory-only');
    expect(ping.pid).toBeGreaterThan(0);

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
  });
});
