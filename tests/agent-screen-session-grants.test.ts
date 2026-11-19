import { describe, expect, it } from 'vitest';
import { ToolExecutors } from '../src/main/agent/executors';
import { buildPermissionRequest } from '../src/main/agent/executor';
import { sessionGrantEligibility } from '../src/main/agent/scope';
import { AuditLog, PermissionBroker } from '../src/main/agent/runtime';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import type { PermissionGrant } from '../src/shared/types';

const windowIdentity = {
  targetWindowId: 'window-ref-1',
  expectedWindowTitle: 'Settings',
  expectedProcessId: 4200,
  expectedProcessName: 'SystemSettings',
};
const selectedWindow = { ...windowIdentity, target: 'selected_window' };

describe('exact-window screen session grants', () => {
  it('offers session authorization only for an explicitly selected, identified window', () => {
    const registry = new ToolRegistry(BUILTIN_TOOLS);
    const tool = registry.get('analyze_screen');
    expect(tool).toBeDefined();
    const request = buildPermissionRequest(tool!, { ...selectedWindow, question: 'Find Display' });
    expect(request.allowSession).toBe(true);
    expect(request.sessionScopeLabel).toContain('SystemSettings');
    expect(sessionGrantEligibility('analyze_screen', { target: 'active_window' }).allowed).toBe(false);
    expect(sessionGrantEligibility('analyze_screen', { ...selectedWindow, expectedProcessId: undefined }).allowed).toBe(false);
    expect(registry.evaluate('get_foreground_window', 'agent', {}).allowed).toBe(true);
    expect(registry.evaluate('list_external_windows', 'agent', {}).allowed).toBe(true);
  });

  it('reuses a volatile grant only for the same live-window identity', () => {
    const registry = new ToolRegistry(BUILTIN_TOOLS);
    let asked = '';
    const broker = new PermissionBroker(registry, new AuditLog(), (request) => { asked = request.id; });
    const request = buildPermissionRequest(registry.get('analyze_screen')!, selectedWindow);
    const pending = broker.ask(request);
    broker.respond({ requestId: request.id, approved: true, duration: 'session' });
    const grantPromise = pending.then((decision) => decision);
    return grantPromise.then((decision) => {
      expect(asked).toBe(request.id);
      expect(decision.approved).toBe(true);
      const grant = registry.activeGrants()[0] as PermissionGrant;
      expect(grant.toolName).toBe('screen_observation_session');
      expect(registry.evaluate('analyze_screen', 'agent', selectedWindow).allowed).toBe(true);
      expect(registry.evaluate('screen_draw_arrow', 'agent', { ...windowIdentity, selector: 'Display' }).allowed).toBe(true);
      expect(registry.evaluate('analyze_screen', 'agent', { ...selectedWindow, targetWindowId: 'another-window' }).allowed).toBe(false);
      expect(registry.revoke(grant.id)).toBe(true);
      expect(registry.evaluate('analyze_screen', 'agent', selectedWindow).allowed).toBe(false);
    });
  });

  it('registers and executes a passive arrow using only verified UIA bounds', async () => {
    const registry = new ToolRegistry(BUILTIN_TOOLS);
    const tool = registry.get('screen_draw_arrow');
    expect(tool).toBeDefined();
    expect(registry.validateArgs('screen_draw_arrow', { ...windowIdentity, selector: 'Display' })).toEqual({ ok: true });
    expect(registry.validateArgs('screen_draw_arrow', { ...windowIdentity, selector: 'Display', x: 5 })).toMatchObject({ ok: false });

    const element = { name: 'Display', role: 'Button', automationId: 'display', rect: { x: 100, y: 200, width: 80, height: 30 }, enabled: true };
    let guidance: Record<string, unknown> | undefined;
    const executors = new ToolExecutors({
      nativeHelper: {
        async call() {
          return {
            window: {
              windowId: selectedWindow.targetWindowId,
              title: selectedWindow.expectedWindowTitle,
              pid: selectedWindow.expectedProcessId,
              processName: selectedWindow.expectedProcessName,
              observedAt: Date.now(),
              rect: { x: 0, y: 0, width: 800, height: 600 },
              isMinimized: false,
            },
            elements: [element],
            truncated: false,
          };
        },
      } as never,
      showVisualGuidance: async (request) => {
        guidance = request;
        return 'visible';
      },
    });
    const result = await executors.run('screen_draw_arrow', { ...windowIdentity, selector: 'Display', label: 'Open display options' });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('displayed the arrow');
    expect(guidance).toMatchObject({ shape: 'arrow', target: { windowId: selectedWindow.targetWindowId }, bounds: element.rect });
  });
});
