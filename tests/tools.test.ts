import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TOOLS,
  ToolRegistry,
  applyDecision,
  classifyInvocationRisk,
  evaluateInvocation,
  hasValidGrant,
  riskWeight,
} from '../src/main/agent/tools';
import type { PermissionGrant, ToolDefinition } from '../src/shared/types';
import { BOARD_TOOL_DEFINITIONS } from '../src/main/board/tools';
import { DOCUMENT_TOOL_DEFINITIONS } from '../src/main/documents/toolset';
import { FILE_TOOL_DEFINITIONS } from '../src/main/files/toolset';
import { MEMORY_TOOL_DEFINITIONS } from '../src/main/memory/toolset';
import { buildPermissionRequest } from '../src/main/agent/executor';

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
  it('keeps the model-facing tool catalog unique and validates every family schema', () => {
    const definitions = [
      ...BUILTIN_TOOLS,
      ...BOARD_TOOL_DEFINITIONS,
      ...MEMORY_TOOL_DEFINITIONS.filter((tool) => tool.name !== 'memory_save'),
      ...DOCUMENT_TOOL_DEFINITIONS,
      ...FILE_TOOL_DEFINITIONS,
    ];
    const names = definitions.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    const registry = new ToolRegistry(definitions);
    for (const tool of definitions) {
      expect(registry.validateArgs(tool.name, {})).not.toMatchObject({ message: expect.stringMatching(/no supported argument contract/i) });
      expect(registry.schemasFor('agent').some((candidate) => candidate.name === tool.name)).toBe(true);
    }
    expect(FILE_TOOL_DEFINITIONS.every((tool) => tool.category === 'files')).toBe(true);
    expect(DOCUMENT_TOOL_DEFINITIONS.every((tool) => tool.category === 'documents')).toBe(true);
  });

  it('validates required arguments and rejects undeclared properties', () => {
    const registry = new ToolRegistry();
    expect(registry.validateArgs('open_application', { name: 'notepad' })).toEqual({ ok: true });
    expect(registry.validateArgs('open_application', {})).toMatchObject({ ok: false });
    expect(registry.validateArgs('open_application', { name: 'notepad', command: 'calc' })).toMatchObject({ ok: false });
  });

  it('validates enum values in tool contracts', () => {
    const registry = new ToolRegistry();
    expect(registry.validateArgs('analyze_screen', { target: 'active_window' })).toEqual({ ok: true });
    expect(registry.validateArgs('analyze_screen', { target: 'desktop_everywhere' })).toMatchObject({ ok: false });
  });

  it('requires one browser target and verified confirmation text for submissions', () => {
    const registry = new ToolRegistry();
    const target = { kind: 'label', value: 'Your name' };
    expect(registry.validateArgs('browser_type', { target, text: 'Ada' })).toEqual({ ok: true });
    expect(registry.validateArgs('browser_type', { selector: '#name', text: 'Ada' })).toEqual({ ok: true });
    expect(registry.validateArgs('browser_type', { target, selector: '#name', text: 'Ada' })).toMatchObject({ ok: false });
    expect(registry.validateArgs('browser_type', { target, text: 'Ada', submit: true })).toMatchObject({ ok: false, message: expect.stringMatching(/expectedText/i) });
    expect(registry.validateArgs('browser_type', { target, text: 'Ada', submit: true, expectedText: 'Saved' })).toEqual({ ok: true });
    expect(registry.validateArgs('browser_click', { target: { kind: 'role', role: 'button', value: 'Save' } })).toEqual({ ok: true });
    expect(registry.validateArgs('browser_upload', { target })).toEqual({ ok: true });
    expect(registry.validateArgs('browser_upload', {})).toMatchObject({ ok: false });
    expect(registry.validateArgs('browser_download', { selector: 'a[download]' })).toEqual({ ok: true });
    expect(registry.validateArgs('browser_download', { target, selector: '#file' })).toMatchObject({ ok: false });
  });

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

  it('raises explicit browser submission to critical and refuses repeat grants', () => {
    const registry = new ToolRegistry();
    const args = { selector: '#send', text: 'hello', submit: true };
    expect(registry.evaluate('browser_type', 'agent', args)).toMatchObject({ allowed: false, needsApproval: true });
    expect(registry.canGrantSession('browser_type', args).allowed).toBe(false);
    expect(registry.canGrantAlways('browser_type', args).allowed).toBe(false);
    expect(registry.grant({ id: 'critical-session', toolName: 'browser_type', scope: 'session', risk: 'critical', grantedAt: Date.now() })).toBe(false);
    expect(registry.grant({ id: 'critical-always', toolName: 'browser_type', scope: 'always', risk: 'critical', policyVersion: 1, grantedAt: Date.now() })).toBe(false);
    expect(registry.evaluate('browser_type', 'agent', { ...args, submit: false })).toMatchObject({ allowed: false, needsApproval: true });
  });

  it('raises unnamed CSS browser clicks and consequential named actions to critical', () => {
    const registry = new ToolRegistry();
    const tool = registry.get('browser_click')!;
    expect(registry.evaluate('browser_click', 'agent', { selector: '#confirm' })).toMatchObject({ allowed: false, needsApproval: true });
    expect(registry.evaluate('browser_click', 'agent', { target: { kind: 'role', role: 'button', value: 'Send message' } })).toMatchObject({ allowed: false, needsApproval: true });
    expect(registry.canGrantSession('browser_click', { selector: '#confirm' }).allowed).toBe(false);
    expect(registry.evaluate('browser_click', 'agent', { target: { kind: 'role', role: 'button', value: 'Open menu' } })).toMatchObject({ allowed: false, needsApproval: true });
    expect(registry.grant({ id: 'critical-click', toolName: 'browser_click', scope: 'always', risk: 'critical', policyVersion: 1, grantedAt: Date.now() })).toBe(false);
    expect(tool.risk).toBe('high');
    expect(classifyInvocationRisk(tool, { selector: '#confirm' })).toBe('critical');
    expect(classifyInvocationRisk(tool, { target: { kind: 'role', role: 'button', value: 'Send message' } })).toBe('critical');
    expect(classifyInvocationRisk(tool, { target: { kind: 'role', role: 'button', value: 'Open menu' } })).toBe('high');
  });

  it('requires a fresh exact-action approval for uploads and a fresh approval for downloads', () => {
    const registry = new ToolRegistry();
    const upload = { target: { kind: 'label', value: 'Attachment' } };
    expect(registry.evaluate('browser_upload', 'agent', upload)).toMatchObject({ allowed: false, needsApproval: true });
    expect(registry.canGrantSession('browser_upload', upload).allowed).toBe(false);
    expect(registry.canGrantAlways('browser_upload', upload).allowed).toBe(false);
    expect(classifyInvocationRisk(registry.get('browser_upload')!, upload)).toBe('critical');
    expect(registry.evaluate('browser_download', 'agent', { target: { kind: 'role', role: 'link', value: 'Download report' } })).toMatchObject({ allowed: false, needsApproval: true });
    expect(registry.canGrantSession('browser_download', {}).allowed).toBe(false);
  });

  it('shows an exact browser form target in approval while withholding both field and confirmation text', () => {
    const tool = new ToolRegistry().get('browser_type')!;
    const approval = buildPermissionRequest(tool, {
      target: { kind: 'label', value: 'Email address' },
      text: 'person@example.test', submit: true, expectedText: 'Thanks person@example.test',
    });
    expect(approval.risk).toBe('critical');
    expect(approval.action).toContain('label "Email address"');
    expect(approval.target).toContain('label "Email address"');
    expect(JSON.stringify(approval)).not.toContain('person@example.test');
    expect(approval.args.text).toContain('hidden for privacy');
    expect(approval.args.expectedText).toBe('[confirmation text hidden]');
  });

  it('revokeAll clears every grant and reports the count', () => {
    const registry = new ToolRegistry();
    registry.grant({ id: 'a', toolName: 'open_application', scope: 'always', target: { app: 'notepad' }, risk: 'medium', policyVersion: 1, grantedAt: Date.now() });
    registry.grant({ id: 'b', toolName: 'type_text', scope: 'once', risk: 'high', grantedAt: Date.now() });
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
    expect(riskWeight('high')).toBeLessThan(riskWeight('critical'));
  });
});
