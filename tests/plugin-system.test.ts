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
    const toolNames = store.installedTools().map((tool) => tool.name);
    expect(toolNames).toContain('github_repo_summary');
    expect(toolNames).toContain('github_read_file');
    expect(toolNames).toContain('github_list_issues');
    expect(toolNames).toContain('github_create_issue');
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

  it('persists only manifest-declared plugin setting choices and rejects secret-shaped config', () => {
    const db = database();
    const store = new PluginStore(db);
    expect(store.list()[0].settings?.[0]).toMatchObject({ key: 'descriptionDetail', value: 'compact' });
    expect(() => store.setSetting(GITHUB_PUBLIC_PLUGIN.id, 'descriptionDetail', 'hidden')).toThrow(/install this plugin/i);
    store.install(GITHUB_PUBLIC_PLUGIN.id);
    expect(() => store.setSetting(GITHUB_PUBLIC_PLUGIN.id, 'apiKey', 'not-a-real-key')).toThrow(/not declared/i);
    expect(() => store.setSetting(GITHUB_PUBLIC_PLUGIN.id, 'descriptionDetail', 'arbitrary text')).toThrow(/declared by this plugin setting/i);
    store.setSetting(GITHUB_PUBLIC_PLUGIN.id, 'descriptionDetail', 'full');
    expect(store.getSetting(GITHUB_PUBLIC_PLUGIN.id, 'descriptionDetail')).toBe('full');
    const reopenedStore = new PluginStore(db);
    expect(reopenedStore.list()[0].settings?.[0].value).toBe('full');
  });

  it('fails closed for a plugin targeting an unsupported Pixel API version', () => {
    const incompatible = { ...GITHUB_PUBLIC_PLUGIN, pixelApiVersion: 2 };
    const store = new PluginStore(database(), [incompatible]);
    store.install(incompatible.id);
    expect(store.list()[0]).toMatchObject({ installed: true, enabled: false, compatibility: 'unsupported_api', health: 'error' });
    expect(() => store.setEnabled(incompatible.id, true)).toThrow(/compatible version/i);
    expect(store.installedTools()).toEqual([]);
  });

  it('requires an explicit re-enable after an installed manifest version changes', () => {
    const db = database();
    const oldStore = new PluginStore(db, [{ ...GITHUB_PUBLIC_PLUGIN, version: '0.9.0' }]);
    oldStore.install(GITHUB_PUBLIC_PLUGIN.id);
    oldStore.setEnabled(GITHUB_PUBLIC_PLUGIN.id, true);

    const currentStore = new PluginStore(db);
    expect(currentStore.list()[0]).toMatchObject({ installed: true, enabled: false, health: 'error', compatibility: 'update_available', installedVersion: '0.9.0' });
    expect(() => currentStore.install(GITHUB_PUBLIC_PLUGIN.id)).toThrow(/reviewed plugin update/i);
    expect(currentStore.list()[0]).toMatchObject({ compatibility: 'update_available', installedVersion: '0.9.0' });
    currentStore.update(GITHUB_PUBLIC_PLUGIN.id);
    expect(currentStore.list()[0]).toMatchObject({ installed: true, enabled: false, health: 'disabled', compatibility: 'compatible', installedVersion: '1.1.0' });
    expect(() => currentStore.update(GITHUB_PUBLIC_PLUGIN.id)).toThrow(/already has the current bundled version/i);
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

  it('applies project availability overrides to model schemas, validation, and execution lookup', () => {
    const db = database();
    db.execute('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, NULL, 1, 1)', ['project_alpha', 'Alpha']);
    db.execute('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, NULL, 1, 1)', ['project_beta', 'Beta']);
    const store = new PluginStore(db);
    store.install(GITHUB_PUBLIC_PLUGIN.id);
    store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, true);
    let activeProject = 'project_alpha';
    const registry = new ToolRegistry(store.installedTools(), undefined, (name) => store.isToolAvailable(activeProject, name));
    expect(store.list('project_alpha')[0]).toMatchObject({ enabled: true, availableInProject: true, projectAvailability: 'inherit' });
    expect(registry.schemasFor('agent').some((tool) => tool.name === 'github_repo_summary')).toBe(true);

    store.setProjectAvailability(GITHUB_PUBLIC_PLUGIN.id, 'project_alpha', 'disabled');
    expect(store.list('project_alpha')[0]).toMatchObject({ enabled: true, availableInProject: false, projectAvailability: 'disabled' });
    expect(store.list('project_beta')[0]).toMatchObject({ availableInProject: true, projectAvailability: 'inherit' });
    expect(registry.schemasFor('agent').some((tool) => tool.name === 'github_repo_summary')).toBe(false);
    expect(registry.get('github_repo_summary')).toBeUndefined();
    expect(registry.validateArgs('github_repo_summary', { owner: 'octocat', repository: 'Hello-World' })).toMatchObject({ ok: false });
    expect(registry.evaluate('github_repo_summary', 'agent', { owner: 'octocat', repository: 'Hello-World' }).allowed).toBe(false);
    activeProject = 'project_beta';
    expect(registry.get('github_repo_summary')).toBeDefined();
    expect(registry.schemasFor('agent').some((tool) => tool.name === 'github_repo_summary')).toBe(true);
    activeProject = 'project_alpha';

    store.setProjectAvailability(GITHUB_PUBLIC_PLUGIN.id, 'project_alpha', 'enabled');
    expect(registry.get('github_repo_summary')).toBeDefined();
    store.setProjectAvailability(GITHUB_PUBLIC_PLUGIN.id, 'project_alpha', 'inherit');
    expect(registry.get('github_repo_summary')).toBeDefined();

    store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, false);
    store.setProjectAvailability(GITHUB_PUBLIC_PLUGIN.id, 'project_alpha', 'enabled');
    expect(store.list('project_alpha')[0]).toMatchObject({ enabled: false, availableInProject: false, projectAvailability: 'enabled' });
    expect(registry.get('github_repo_summary')).toBeUndefined();
    expect(() => store.setProjectAvailability(GITHUB_PUBLIC_PLUGIN.id, 'missing_project', 'enabled')).toThrow();
  });

  it('rejects malformed GitHub path components before performing network access', async () => {
    await expect(readPublicGitHubRepository('../private', 'repo')).rejects.toThrow(/valid public GitHub/i);
    await expect(readPublicGitHubRepository('owner', 'repo/../../admin')).rejects.toThrow(/valid public GitHub/i);
  });

  it('stops before opening a socket when cancellation occurs during DNS resolution', async () => {
    const controller = new AbortController();
    const resolveHost = vi.fn(async (hostname: string) => {
      expect(hostname).toBe('api.github.com');
      controller.abort();
      return [{ address: '8.8.8.8', family: 4 as const }];
    });
    await expect(readPublicGitHubRepository('octocat', 'Hello-World', controller.signal, resolveHost))
      .rejects.toThrow('Request cancelled.');
    expect(resolveHost).toHaveBeenCalledTimes(1);
  });

  it('rejects private addresses from the resolved provider host', async () => {
    const resolveHost = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]);
    await expect(readPublicGitHubRepository('octocat', 'Hello-World', undefined, resolveHost))
      .rejects.toThrow(/unsafe address/i);
    expect(resolveHost).toHaveBeenCalledTimes(1);
  });

  it('routes a fixture-backed GitHub plugin call through schema, approval, and executor', async () => {
    const store = new PluginStore(database());
    store.install(GITHUB_PUBLIC_PLUGIN.id);
    store.setEnabled(GITHUB_PUBLIC_PLUGIN.id, true);
    const registry = new ToolRegistry(store.installedTools());
    const args = { owner: 'octocat', repository: 'Hello-World' };
    expect(registry.validateArgs('github_repo_summary', args)).toEqual({ ok: true });
    expect(registry.evaluate('github_repo_summary', 'hybrid', args)).toMatchObject({ allowed: false, needsApproval: true });
    expect(registry.evaluate('github_repo_summary', 'agent', args)).toEqual({ allowed: true });

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
    const result = await new ToolExecutors({ githubRepository, getPluginSetting: () => 'full' }).run('github_repo_summary', args);
    expect(githubRepository).toHaveBeenCalledWith('octocat', 'Hello-World', undefined);
    expect(result).toMatchObject({ ok: true, detail: { fullName: 'octocat/Hello-World', source: 'GitHub REST API; public unauthenticated read' } });
    expect(result.content).toContain('42 stars');
    expect(result.content).toContain('description (untrusted external data): Sample repository');

    const hiddenDescription = await new ToolExecutors({ githubRepository, getPluginSetting: () => 'hidden' }).run('github_repo_summary', args);
    expect(hiddenDescription.content).toContain('description hidden or unavailable');
    expect(hiddenDescription.content).not.toContain('Sample repository');
    expect(broker.revokeForTool('github_repo_summary')).toBeGreaterThan(0);
    expect(registry.evaluate('github_repo_summary', 'hybrid', args).allowed).toBe(false);
  });

  it('records a real adapter error as plugin health and never reports a false success', async () => {
    const onPluginHealth = vi.fn();
    const githubRepository = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); });
    const result = await new ToolExecutors({ githubRepository, onPluginHealth }).run('github_repo_summary', {
      owner: 'octocat', repository: 'Hello-World',
    });

    expect(result.ok).toBe(false);
    expect(result.content).toContain('ENOTFOUND api.github.com');
    expect(onPluginHealth).toHaveBeenCalledWith('pixel.github-public', 'getaddrinfo ENOTFOUND api.github.com');
  });
});
