import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionRequest } from '../src/shared/types';
import { openDatabase } from '../src/main/data/database';
import { ToolExecutors } from '../src/main/agent/executors';
import { buildPermissionRequest } from '../src/main/agent/executor';
import { AuditLog, PermissionBroker } from '../src/main/agent/runtime';
import { ToolRegistry } from '../src/main/agent/tools';
import { GITHUB_PUBLIC_PLUGIN } from '../src/main/plugins/manifest';
import { PluginStore } from '../src/main/plugins/store';
import { readPublicGitHubRepository } from '../src/main/plugins/github';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database() {
  const db = openDatabase(':memory:');
  databases.push(db);
  return db;
}

describe('Pixel plugin foundation', () => {
  it('keeps the catalog separate from installed and enabled plugin state', () => {
    const store = new PluginStore(database());
    expect(store.list()[0]).toMatchObject({ id: GITHUB_PUBLIC_PLUGIN.id, installed: false, enabled: false, connection: 'not_required' });
    store.install(GITHUB_PUBLIC_PLUGIN.id);
    expect(store.list()[0]).toMatchObject({ installed: true, enabled: false, health: 'disabled' });
    expect(store.installedTools()).toHaveLength(0);
    store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, true);
    expect(store.installedTools().map((tool) => tool.name)).toEqual(['github_repo_summary']);
    store.recordHealth(GITHUB_PUBLIC_PLUGIN.id, 'temporary provider error');
    expect(store.list()[0]).toMatchObject({ health: 'error', error: 'temporary provider error' });
    store.recordHealth(GITHUB_PUBLIC_PLUGIN.id);
    expect(store.list()[0]).toMatchObject({ health: 'ready' });
    store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, false);
    store.uninstall(GITHUB_PUBLIC_PLUGIN.id);
    expect(store.list()[0].installed).toBe(false);
  });

  it('checks manifest compatibility and refuses unknown plugin identifiers', () => {
    const store = new PluginStore(database());
    expect(() => store.install('third-party.unreviewed')).toThrow(/reviewed catalog/i);
    store.install(GITHUB_PUBLIC_PLUGIN.id);
    expect(() => store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, true)).not.toThrow();
  });

  it('requires an explicit re-enable after an installed manifest version changes', () => {
    const db = database();
    const oldStore = new PluginStore(db, [{ ...GITHUB_PUBLIC_PLUGIN, version: '0.9.0' }]);
    oldStore.install(GITHUB_PUBLIC_PLUGIN.id);
    oldStore.setEnabled(GITHUB_PUBLIC_PLUGIN.id, true);

    const currentStore = new PluginStore(db);
    expect(currentStore.list()[0]).toMatchObject({ installed: true, enabled: false, health: 'error' });
    currentStore.install(GITHUB_PUBLIC_PLUGIN.id);
    expect(currentStore.list()[0]).toMatchObject({ installed: true, enabled: false, health: 'disabled' });
  });

  it('only exposes plugin tools while the stored installation is enabled', () => {
    const store = new PluginStore(database());
    store.install(GITHUB_PUBLIC_PLUGIN.id);
    const registry = new ToolRegistry();
    expect(registry.get('github_repo_summary')).toBeUndefined();
    store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, true);
    for (const tool of store.installedTools()) registry.register(tool);
    expect(registry.get('github_repo_summary')).toBeDefined();
    store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, false);
    registry.unregister('github_repo_summary');
    expect(registry.get('github_repo_summary')).toBeUndefined();
    expect(registry.validateArgs('github_repo_summary', { owner: 'octocat', repository: 'Hello-World' })).toMatchObject({ ok: false });
  });

  it('rejects malformed GitHub path components before performing network access', async () => {
    await expect(readPublicGitHubRepository('../private', 'repo')).rejects.toThrow(/valid public GitHub/i);
    await expect(readPublicGitHubRepository('owner', 'repo/../../admin')).rejects.toThrow(/valid public GitHub/i);
  });

  it('routes a fixture-backed GitHub plugin call through schema, approval, and executor', async () => {
    const store = new PluginStore(database());
    store.install(GITHUB_PUBLIC_PLUGIN.id);
    store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, true);
    const registry = new ToolRegistry(store.installedTools());
    const args = { owner: 'octocat', repository: 'Hello-World' };
    expect(registry.validateArgs('github_repo_summary', args)).toEqual({ ok: true });
    expect(registry.evaluate('github_repo_summary', 'agent', args)).toMatchObject({ allowed: false, needsApproval: true });

    const prompts: PermissionRequest[] = [];
    const broker = new PermissionBroker(registry, new AuditLog(), (request) => prompts.push(request));
    const tool = registry.get('github_repo_summary');
    if (!tool) throw new Error('plugin tool was not registered');
    const requestPromise = broker.ask(buildPermissionRequest(tool, args));
    broker.respond({ requestId: prompts[0].id, approved: true, duration: 'once' });
    await expect(requestPromise).resolves.toMatchObject({ approved: true, duration: 'once' });
    expect(registry.evaluate('github_repo_summary', 'agent', args).allowed).toBe(true);

    const githubRepository = vi.fn(async () => ({
      fullName: 'octocat/Hello-World', description: 'Sample repository', url: 'https://github.com/octocat/Hello-World',
      stars: 42, forks: 7, openIssues: 2, defaultBranch: 'main', updatedAt: '2026-11-21T00:00:00Z',
    }));
    const result = await new ToolExecutors({ githubRepository }).run('github_repo_summary', args);
    expect(githubRepository).toHaveBeenCalledWith('octocat', 'Hello-World', undefined);
    expect(result).toMatchObject({ ok: true, detail: { fullName: 'octocat/Hello-World', source: 'GitHub REST API; public unauthenticated read' } });
    expect(result.content).toContain('42 stars');
    broker.revoke('github_repo_summary');
    expect(registry.evaluate('github_repo_summary', 'agent', args).allowed).toBe(false);
  });
});
