import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/main/data/database';
import { AuditLog, PermissionBroker } from '../src/main/agent/runtime';
import { PermissionGrantStore } from '../src/main/agent/permissionStore';
import { ToolRegistry } from '../src/main/agent/tools';
import type { PermissionRequest } from '../src/shared/types';

const databases: Database[] = [];
function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const store = new PermissionGrantStore(db);
  const registry = new ToolRegistry();
  const broker = new PermissionBroker(registry, new AuditLog(), () => undefined, () => undefined, store);
  return { db, store, registry, broker };
}
function request(toolName: string, args: Record<string, unknown>, risk: PermissionRequest['risk'] = 'medium'): PermissionRequest {
  return { id: `request-${toolName}`, toolName, args, action: `Run ${toolName}`, target: String(args.name ?? 'selected target'), changesData: true, risk, duration: 'once', createdAt: Date.now(), allowPersistent: true, alwaysAllowed: true };
}

afterEach(() => { while (databases.length) databases.pop()?.close(); });

describe('persistent permission grants', () => {
  it('persists an exact Notepad grant across broker restart and rejects another app', async () => {
    const first = setup();
    const pending = first.broker.ask(request('open_application', { name: 'Notepad' }));
    first.broker.respond({ requestId: 'request-open_application', approved: true, duration: 'always' });
    await expect(pending).resolves.toMatchObject({ approved: true, duration: 'always' });
    expect(first.store.listActive()).toHaveLength(1);

    const restarted = new ToolRegistry();
    new PermissionBroker(restarted, new AuditLog(), () => undefined, () => undefined, first.store);
    expect(restarted.evaluate('open_application', 'agent', { name: 'notepad.exe' }).allowed).toBe(true);
    expect(restarted.evaluate('open_application', 'agent', { name: 'powershell' })).toMatchObject({ allowed: false, needsApproval: true });
  });

  it('persists selected-window observation by exact process and title without granting UI actions', async () => {
    const first = setup();
    const args = {
      target: 'selected_window',
      targetWindowId: 'hwnd-before-restart',
      expectedWindowTitle: 'Settings',
      expectedProcessId: 4200,
      expectedProcessName: 'SystemSettings',
    };
    const pending = first.broker.ask(request('analyze_screen', args, 'medium'));
    first.broker.respond({ requestId: 'request-analyze_screen', approved: true, duration: 'always' });
    await expect(pending).resolves.toMatchObject({ approved: true, duration: 'always' });

    const restarted = new ToolRegistry();
    new PermissionBroker(restarted, new AuditLog(), () => undefined, () => undefined, first.store);
    expect(restarted.evaluate('analyze_screen', 'agent', {
      ...args,
      targetWindowId: 'new-hwnd',
      expectedProcessId: 8800,
    }).allowed).toBe(true);
    expect(restarted.evaluate('analyze_screen', 'agent', {
      ...args,
      expectedWindowTitle: 'Passwords',
    }).allowed).toBe(false);
    expect(restarted.evaluate('invoke_ui_element', 'agent', args).allowed).toBe(false);
  });

  it('revokes one grant and does not restore it after restart', async () => {
    const first = setup();
    const pending = first.broker.ask(request('open_application', { name: 'notepad' }));
    first.broker.respond({ requestId: 'request-open_application', approved: true, duration: 'always' });
    await pending;
    const grant = first.broker.activeGrants().find((item) => item.scope === 'always')!;
    expect(first.broker.revokeGrant(grant.id)).toBe(true);
    expect(first.store.listActive()).toEqual([]);

    const restarted = new ToolRegistry();
    new PermissionBroker(restarted, new AuditLog(), () => undefined, () => undefined, first.store);
    expect(restarted.evaluate('open_application', 'agent', { name: 'notepad' }).allowed).toBe(false);
  });

  it('revokes a tool grant and cancels a pending approval when plugin access changes', async () => {
    const first = setup();
    const standing = first.broker.ask(request('open_application', { name: 'Notepad' }));
    first.broker.respond({ requestId: 'request-open_application', approved: true, duration: 'always' });
    await expect(standing).resolves.toMatchObject({ approved: true, duration: 'always' });
    expect(first.store.listActive()).toHaveLength(1);

    const pendingRequest = { ...request('open_application', { name: 'Calculator' }), id: 'pending-plugin-action' };
    const pending = first.broker.ask(pendingRequest);
    expect(first.broker.revokeForTool('open_application')).toBeGreaterThan(0);
    await expect(pending).resolves.toMatchObject({ approved: false });
    expect(first.store.listActive()).toEqual([]);
    expect(first.registry.activeGrants()).toEqual([]);

    const restarted = new ToolRegistry();
    new PermissionBroker(restarted, new AuditLog(), () => undefined, () => undefined, first.store);
    expect(restarted.evaluate('open_application', 'agent', { name: 'notepad' }).allowed).toBe(false);
  });

  it('rejects Always Allow for high-risk input without silently approving once', async () => {
    const { broker, registry } = setup();
    const pending = broker.ask(request('type_text', { text: 'hello' }, 'high'));
    broker.respond({ requestId: 'request-type_text', approved: true, duration: 'always' });
    await expect(pending).resolves.toMatchObject({ approved: false, duration: 'once' });
    expect(registry.activeGrants()).toEqual([]);
  });

  it('revokes saved permissions during emergency-stop revocation', async () => {
    const first = setup();
    const pending = first.broker.ask(request('open_application', { name: 'notepad' }));
    first.broker.respond({ requestId: 'request-open_application', approved: true, duration: 'always' });
    await pending;
    expect(first.broker.revokeAll()).toBeGreaterThan(0);
    expect(first.store.listActive()).toEqual([]);
    const revoked = first.db.queryOne<{ revoked_at: number | null }>('SELECT revoked_at FROM permission_grants LIMIT 1');
    expect(revoked?.revoked_at).toBeTypeOf('number');
  });

  it('invalidates a persisted grant after its policy version changes', () => {
    const { db, store, registry } = setup();
    const now = Date.now();
    db.execute(
      `INSERT INTO permission_grants (id, tool_name, target_json, risk, created_at, last_used_at, expires_at, revoked_at, policy_version)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      ['old-policy', 'open_application', '{"app":"notepad"}', 'medium', now, 0],
    );
    new PermissionBroker(registry, new AuditLog(), () => undefined, () => undefined, store);
    expect(registry.evaluate('open_application', 'agent', { name: 'notepad' }).allowed).toBe(false);
    expect(db.queryOne<{ revoked_at: number | null }>('SELECT revoked_at FROM permission_grants WHERE id = ?', ['old-policy'])?.revoked_at).toBeTypeOf('number');
  });
});
