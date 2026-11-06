import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TOOLS,
  ToolRegistry,
  applyDecision,
  evaluateInvocation,
  hasValidGrant,
  riskWeight,
} from '../src/main/agent/tools';
import type { PermissionGrant, ToolDefinition } from '../src/shared/types';

function context(overrides: Partial<Parameters<typeof evaluateInvocation>[1]> = {}) {
  return {
    mode: 'agent' as const,
    grants: new Map<string, PermissionGrant>(),
    stopped: false,
    audit: () => {},
    ...overrides,
  };
}

const destructiveTool: ToolDefinition = {
  name: 'type_text',
  description: 'types',
  category: 'input',
  risk: 'high',
  requiresApproval: true,
  changesState: true,
  parameters: { type: 'object', properties: {} },
};

const readOnlyTool: ToolDefinition = {
  name: 'get_current_time',
  description: 'time',
  category: 'system',
  risk: 'safe',
  requiresApproval: false,
  changesState: false,
  parameters: { type: 'object', properties: {} },
};

describe('evaluateInvocation', () => {
  it('rejects unknown tools', () => {
    const decision = evaluateInvocation(undefined, context());
    expect(decision.allowed).toBe(false);
  });

  it('refuses every tool while emergency stop is active, even with a grant', () => {
    const grants = new Map<string, PermissionGrant>([
      ['type_text', { id: 'g', toolName: 'type_text', scope: 'always', grantedAt: Date.now() }],
    ]);
    const decision = evaluateInvocation(readOnlyTool, context({ stopped: true, grants }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/emergency stop/i);
  });

  it('blocks a state-changing tool in guide mode', () => {
    const decision = evaluateInvocation(destructiveTool, context({ mode: 'guide' }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.needsApproval).toBe(false);
      expect(decision.reason).toMatch(/guide/i);
    }
  });

  it('allows a read-only tool in guide mode', () => {
    expect(evaluateInvocation(readOnlyTool, context({ mode: 'guide' })).allowed).toBe(true);
  });

  it('asks for approval when a tool requires one and has no grant', () => {
    const decision = evaluateInvocation(destructiveTool, context({ mode: 'agent' }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.needsApproval).toBe(true);
  });

  it('allows an approved state-changing tool in agent mode', () => {
    const grants = new Map<string, PermissionGrant>([
      ['type_text', { id: 'g', toolName: 'type_text', scope: 'once', grantedAt: Date.now() }],
    ]);
    expect(evaluateInvocation(destructiveTool, context({ grants })).allowed).toBe(true);
  });

  it('allows state-changing tools in hybrid mode only once approved', () => {
    expect(evaluateInvocation(destructiveTool, context({ mode: 'hybrid' })).allowed).toBe(false);
    const grants = new Map<string, PermissionGrant>([
      ['type_text', { id: 'g', toolName: 'type_text', scope: 'session', grantedAt: Date.now() }],
    ]);
    expect(evaluateInvocation(destructiveTool, context({ mode: 'hybrid', grants })).allowed).toBe(
      true,
    );
  });
});

describe('hasValidGrant', () => {
  it('treats a missing grant as absent', () => {
    expect(hasValidGrant('x', context())).toBe(false);
  });

  it('rejects an expired session grant and cleans it up', () => {
    const grants = new Map<string, PermissionGrant>([
      [
        'type_text',
        {
          id: 'g',
          toolName: 'type_text',
          scope: 'session',
          grantedAt: Date.now() - 1000,
          expiresAt: Date.now() - 1,
        },
      ],
    ]);
    const ctx = context({ grants });
    expect(hasValidGrant('type_text', ctx)).toBe(false);
    expect(ctx.grants.size).toBe(0);
  });

  it('never expires an always grant', () => {
    const grants = new Map<string, PermissionGrant>([
      ['type_text', { id: 'g', toolName: 'type_text', scope: 'always', grantedAt: 0 }],
    ]);
    expect(hasValidGrant('type_text', context({ grants }))).toBe(true);
  });
});

describe('applyDecision', () => {
  it('returns null when the user denies', () => {
    expect(applyDecision({ requestId: 'r1', approved: false, duration: 'once' }, { toolName: 'x' })).toBeNull();
  });

  it('creates a session grant that expires', () => {
    const grant = applyDecision({ requestId: 'r2', approved: true, duration: 'session' }, { toolName: 'x' });
    expect(grant?.scope).toBe('session');
    expect(grant?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('creates a one-shot grant with no expiry', () => {
    const grant = applyDecision({ requestId: 'r3', approved: true, duration: 'once' }, { toolName: 'x' });
    expect(grant?.expiresAt).toBeUndefined();
  });

  it('gives every grant a unique id', () => {
    const a = applyDecision({ requestId: 'r4', approved: true, duration: 'always' }, { toolName: 'x' });
    const b = applyDecision({ requestId: 'r4', approved: true, duration: 'always' }, { toolName: 'x' });
    expect(a?.id).not.toBe(b?.id);
  });
});

describe('ToolRegistry', () => {
  it('exposes only read-only tools in guide mode', () => {
    const registry = new ToolRegistry();
    const available = registry.availableFor('guide');
    expect(available.length).toBeGreaterThan(0);
    expect(available.every((t) => !t.changesState)).toBe(true);
  });

  it('exposes state-changing tools in agent mode', () => {
    const registry = new ToolRegistry();
    expect(registry.availableFor('agent').some((t) => t.changesState)).toBe(true);
  });

  it('blocks everything when stopped', () => {
    const registry = new ToolRegistry();
    registry.setStopped(true);
    expect(registry.evaluate('get_current_time', 'agent').allowed).toBe(false);
  });

  it('revokeAll clears every grant and reports the count', () => {
    const registry = new ToolRegistry();
    registry.grant({ id: 'a', toolName: 'type_text', scope: 'always', grantedAt: Date.now() });
    registry.grant({ id: 'b', toolName: 'open_application', scope: 'session', grantedAt: Date.now() });
    expect(registry.activeGrants()).toHaveLength(2);
    expect(registry.revokeAll()).toBe(2);
    expect(registry.activeGrants()).toHaveLength(0);
  });

  it('every built-in state-changing tool requires approval', () => {
    for (const tool of BUILTIN_TOOLS) {
      if (tool.changesState) expect(tool.requiresApproval).toBe(true);
    }
  });

  it('the registry never mutates the shared definition array', () => {
    const before = BUILTIN_TOOLS.length;
    const registry = new ToolRegistry();
    registry.availableFor('agent');
    expect(BUILTIN_TOOLS).toHaveLength(before);
  });
});

describe('riskWeight', () => {
  it('orders risk from safe to high', () => {
    expect(riskWeight('safe')).toBeLessThan(riskWeight('low'));
    expect(riskWeight('low')).toBeLessThan(riskWeight('medium'));
    expect(riskWeight('medium')).toBeLessThan(riskWeight('high'));
  });
});