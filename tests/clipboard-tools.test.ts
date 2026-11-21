import { describe, expect, it, vi } from 'vitest';
import { ToolExecutors } from '../src/main/agent/executors';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import { buildPermissionRequest } from '../src/main/agent/executor';
import type { NativeHelper } from '../src/main/services/nativeHelper';

function clipboard(initial = '') {
  let value = initial;
  return {
    readText: vi.fn(() => value),
    writeText: vi.fn((next: string) => { value = next; }),
    current: () => value,
    set: (next: string) => { value = next; },
  };
}

describe('agent clipboard tools', () => {
  it('registers strict schemas and requires explicit high-risk approval for read and copy', () => {
    const registry = new ToolRegistry(BUILTIN_TOOLS);
    for (const name of ['clipboard_read', 'clipboard_copy', 'clipboard_restore', 'clipboard_paste']) {
      expect(registry.get(name)).toBeDefined();
    }
    expect(registry.validateArgs('clipboard_read', { extra: true }).ok).toBe(false);
    expect(registry.evaluate('clipboard_read', 'agent', {}).allowed).toBe(false);
    expect(registry.evaluate('clipboard_copy', 'agent', { text: 'hello' }).allowed).toBe(false);
    expect(registry.get('clipboard_read')).toMatchObject({ risk: 'high', requiresApproval: true });
    expect(registry.grant({ id: 'clipboard-always', toolName: 'clipboard_read', scope: 'always', grantedAt: Date.now(), risk: 'high', policyVersion: 1 })).toBe(false);
    const approval = buildPermissionRequest(registry.get('clipboard_copy')!, { text: 'private content to copy' });
    expect(JSON.stringify(approval)).not.toContain('private content to copy');
    expect(approval.args.text).toContain('hidden for privacy');
  });

  it('reads text only on invocation and refuses common credential-like values', async () => {
    const clip = clipboard('A harmless copied sentence.');
    const executors = new ToolExecutors({ clipboard: clip });
    const result = await executors.run('clipboard_read', {});
    expect(result.ok).toBe(true);
    expect(result.content).toContain('A harmless copied sentence.');
    expect(result.verification?.source).toBe('Electron clipboard text read');

    clip.set('api_key: sk-abcdefghijklmnop');
    const blocked = await executors.run('clipboard_read', {});
    expect(blocked).toMatchObject({ ok: false, errorCode: 'DENIED' });
    expect(blocked.content).not.toContain('sk-abcdefghijklmnop');
  });

  it('copies with read-back verification and conditionally restores only if clipboard is unchanged', async () => {
    const clip = clipboard('user clipboard');
    const executors = new ToolExecutors({ clipboard: clip });
    const copied = await executors.run('clipboard_copy', { text: 'approved content' });
    expect(copied.ok).toBe(true);
    expect(clip.current()).toBe('approved content');
    const token = String(copied.detail?.restoreToken ?? '');
    expect(token.length).toBeGreaterThan(20);

    const restored = await executors.run('clipboard_restore', { restoreToken: token });
    expect(restored).toMatchObject({ ok: true, verification: { source: 'Electron clipboard text read-back' } });
    expect(clip.current()).toBe('user clipboard');

    const second = await executors.run('clipboard_copy', { text: 'Pixel text' });
    const secondToken = String(second.detail?.restoreToken ?? '');
    clip.set('user changed clipboard');
    const conflict = await executors.run('clipboard_restore', { restoreToken: secondToken });
    expect(conflict).toMatchObject({ ok: false, errorCode: 'DENIED' });
    expect(clip.current()).toBe('user changed clipboard');
  });

  it('does not retain credential-like or oversized prior clipboard values for restoration', async () => {
    const clip = clipboard('api_key: sk-abcdefghijklmnop');
    const executors = new ToolExecutors({ clipboard: clip });
    const copied = await executors.run('clipboard_copy', { text: 'approved content' });
    expect(copied.ok).toBe(true);
    expect(copied.detail).toMatchObject({ restorable: false });
    expect(copied.detail?.restoreToken).toBeUndefined();
    expect(copied.content).not.toContain('sk-abcdefghijklmnop');
  });

  it('sets clipboard text only into a verified UIA editable control and rejects secret values', async () => {
    const clip = clipboard('paste this harmless value');
    const nativeCall = vi.fn().mockResolvedValue({
      window: { title: 'Notepad' },
      element: { role: 'Edit', name: 'Document', automationId: 'editor', rect: { x: 0, y: 0, width: 20, height: 20 } },
      valueLength: clip.current().length,
      verified: true,
    });
    const executors = new ToolExecutors({ clipboard: clip, nativeHelper: { call: nativeCall } as unknown as NativeHelper });
    const args = { selector: 'editor', targetWindowId: 'w1', expectedWindowTitle: 'Notepad', expectedProcessId: 123, expectedProcessName: 'notepad' };
    const result = await executors.run('clipboard_paste', args);
    expect(result).toMatchObject({ ok: true, verification: { source: 'UI Automation ValuePattern read-back' } });
    expect(nativeCall).toHaveBeenCalledWith('set_element_value', expect.objectContaining({ value: 'paste this harmless value' }), undefined);
    expect(result.content).not.toContain('paste this harmless value');

    clip.set('Bearer abcdefghijklmnopqrstuvwxyz');
    const blocked = await executors.run('clipboard_paste', args);
    expect(blocked).toMatchObject({ ok: false, errorCode: 'DENIED' });
    expect(nativeCall).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable clipboard support instead of claiming success', async () => {
    const result = await new ToolExecutors().run('clipboard_read', {});
    expect(result).toMatchObject({ ok: false, errorCode: 'UNAVAILABLE' });
  });
});
