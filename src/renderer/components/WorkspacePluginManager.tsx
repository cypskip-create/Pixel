import { useEffect, useRef, useState } from 'react';
import type { GitHubConnectionStatus, GoogleCalendarConnectionStatus, McpServerSummaryView, PluginView } from '@shared/types';

export type PluginLifecycleAction = 'install' | 'update' | 'uninstall' | 'enable' | 'project-availability' | 'setting';
export type PluginProjectAvailability = 'inherit' | 'enabled' | 'disabled';
export interface PluginSettingChange { key: string; value: string }

interface WorkspacePluginManagerProps {
  plugins: PluginView[];
  onChange: (action: PluginLifecycleAction, pluginId: string, enabled?: boolean, availability?: PluginProjectAvailability, setting?: PluginSettingChange) => Promise<void>;
}

export function WorkspacePluginManager({ plugins, onChange }: WorkspacePluginManagerProps): React.JSX.Element {
  const [pendingPluginId, setPendingPluginId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ghStatus, setGhStatus] = useState<GitHubConnectionStatus | null>(null);
  const [ghTokenInput, setGhTokenInput] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const pendingLock = useRef(false);
  const available = plugins.filter((plugin) => !plugin.installed);
  const installed = plugins.filter((plugin) => plugin.installed);
  const githubBridge = typeof window !== 'undefined' ? window.cyps?.plugins : undefined;

  useEffect(() => {
    if (!githubBridge?.githubStatus) return;
    let active = true;
    void githubBridge.githubStatus().then((status) => {
      if (active) setGhStatus(status);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [githubBridge]);

  const handleGitHubConnect = async (): Promise<void> => {
    if (!githubBridge?.githubConnect || !ghTokenInput.trim() || ghBusy) return;
    setGhBusy(true);
    try {
      const next = await githubBridge.githubConnect(ghTokenInput.trim());
      setGhStatus(next);
      if (next.connected) setGhTokenInput('');
    } finally {
      setGhBusy(false);
    }
  };

  const handleGitHubDisconnect = async (): Promise<void> => {
    if (!githubBridge?.githubDisconnect || ghBusy) return;
    setGhBusy(true);
    try {
      const next = await githubBridge.githubDisconnect();
      setGhStatus(next);
    } finally {
      setGhBusy(false);
    }
  };

  const runAction = async (action: PluginLifecycleAction, plugin: PluginView, enabled?: boolean, availability?: PluginProjectAvailability, setting?: PluginSettingChange): Promise<void> => {
    if (pendingLock.current) return;
    pendingLock.current = true;
    setActionError(null);
    setPendingPluginId(plugin.id);
    try {
      if (setting) await onChange(action, plugin.id, enabled, availability, setting);
      else await onChange(action, plugin.id, enabled, availability);
    }
    catch { setActionError(`Pixel could not ${action} ${plugin.name}.`); }
    finally { pendingLock.current = false; setPendingPluginId(null); }
  };

  const renderPlugin = (plugin: PluginView): React.JSX.Element => {
    const pending = pendingPluginId === plugin.id;
    return <article className="workspace-plugin-card" key={plugin.id} aria-busy={pending}>
      <header>
        <div><h2>{plugin.name}</h2><p>by {plugin.publisher} · v{plugin.version}{plugin.installedVersion && plugin.installedVersion !== plugin.version ? ` · installed v${plugin.installedVersion}` : ''}</p></div>
        <span className={`workspace-plugin-status plugin-${plugin.health}`}>{plugin.health}</span>
      </header>
      {plugin.compatibility === 'update_available' ? <p className="workspace-plugin-update" role="status">Reviewed update available: v{plugin.installedVersion} → v{plugin.version}. Updating disables this plugin; review and enable it again afterward.</p> : null}
      <p className="workspace-plugin-description">{plugin.description}</p>
      <section className="workspace-plugin-capabilities" aria-label={`${plugin.name} capabilities`}>
        <h3>Capabilities</h3><ul>{plugin.capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul>
      </section>
      <details className="workspace-plugin-permissions">
        <summary>Permissions <span>{plugin.permissions.length}</span></summary>
        <ul>{plugin.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul>
      </details>
      <p className="workspace-plugin-connection">
        {plugin.connection === 'not_required' ? 'No account connection required' : plugin.connection === 'connected' ? 'Account connected' : 'Account not connected'}
      </p>
      {plugin.id === 'pixel.github-public' && plugin.installed && githubBridge?.githubConnect ? (
        <section className="workspace-plugin-settings" aria-label="GitHub account connection">
          <h3>GitHub Account (Optional)</h3>
          <p className="text-[11px] text-[var(--color-ink-dim)]">
            {ghStatus?.connected
              ? `Connected${ghStatus.login ? ` as @${ghStatus.login}` : ''}${ghStatus.scopes?.length ? ` · Scopes: ${ghStatus.scopes.join(', ')}` : ''}${ghStatus.verified === false ? ' (verification failed)' : ''}.`
              : 'Public repository reads work without an account. Connect a scoped Personal Access Token (stored via Windows DPAPI) for private repos, issues, and PRs.'}
          </p>
          {ghStatus?.error ? <p className="workspace-plugin-error" role="status">{ghStatus.error}</p> : null}
          {ghStatus?.connected ? (
            <div className="mt-1.5 flex items-center gap-2">
              <button type="button" disabled={ghBusy} onClick={() => void handleGitHubDisconnect()}>
                {ghBusy ? 'Removing…' : 'Disconnect local token'}
              </button>
              <small className="text-[10.5px] text-[var(--color-ink-dim)]">Removes local encrypted token; revoke on github.com separately.</small>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="password"
                aria-label="GitHub personal access token"
                placeholder="ghp_… or github_pat_…"
                value={ghTokenInput}
                disabled={ghBusy}
                onChange={(event) => setGhTokenInput(event.currentTarget.value)}
                className="no-drag flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              />
              <button type="button" disabled={ghBusy || !ghTokenInput.trim()} onClick={() => void handleGitHubConnect()}>
                {ghBusy ? 'Verifying…' : 'Connect'}
              </button>
            </div>
          )}
        </section>
      ) : null}
      {plugin.installed && plugin.settings?.length ? <section className="workspace-plugin-settings" aria-label={`${plugin.name} settings`}>
        <h3>Settings</h3>
        {plugin.settings.map((setting) => {
          const settingId = `plugin-setting-${plugin.id}-${setting.key}`;
          return <label key={setting.key} htmlFor={settingId}>
            <span><strong>{setting.label}</strong><small>{setting.description}</small></span>
            <select id={settingId} value={setting.value} disabled={pendingPluginId !== null}
              onChange={(event) => void runAction('setting', plugin, undefined, undefined, { key: setting.key, value: event.currentTarget.value })}>
              {setting.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>;
        })}
      </section> : null}
      {plugin.updatedAt ? <p className="workspace-plugin-updated">Updated {new Date(plugin.updatedAt).toLocaleString()}</p> : null}
      {plugin.error ? <p className="workspace-plugin-error" role="status">{plugin.error}</p> : null}
      {plugin.installed ? <div className="workspace-plugin-project-availability">
        <label htmlFor={`plugin-project-availability-${plugin.id}`}>Available in this project</label>
        <select
          id={`plugin-project-availability-${plugin.id}`}
          value={plugin.projectAvailability ?? 'inherit'}
          disabled={pendingPluginId !== null}
          onChange={(event) => void runAction('project-availability', plugin, undefined, event.currentTarget.value as PluginProjectAvailability)}
        >
          <option value="inherit">Follow global setting</option>
          <option value="enabled">Enable for this project</option>
          <option value="disabled">Disable for this project</option>
        </select>
        <p role="status">{!plugin.enabled
          ? 'The plugin is disabled globally, so it is unavailable in every project.'
          : plugin.availableInProject === false
            ? 'Disabled for this project.'
            : plugin.projectAvailability === 'enabled'
              ? 'Enabled for this project; the global plugin switch still applies.'
              : 'Available through the global plugin setting.'}</p>
      </div> : null}
      <footer>
        {!plugin.installed ? <button type="button" disabled={pendingPluginId !== null} onClick={() => void runAction('install', plugin)}>{pending ? 'Installing…' : 'Install'}</button> : null}
        {plugin.installed && plugin.compatibility === 'update_available' ? <button type="button" disabled={pendingPluginId !== null} onClick={() => void runAction('update', plugin)}>{pending ? 'Updating…' : 'Update'}</button> : null}
        {plugin.installed ? <button type="button" disabled={pendingPluginId !== null} aria-pressed={plugin.enabled} onClick={() => void runAction('enable', plugin, !plugin.enabled)}>{pending ? 'Updating…' : plugin.enabled ? 'Disable' : 'Enable'}</button> : null}
        {plugin.installed ? <button type="button" disabled={pendingPluginId !== null} className="workspace-plugin-remove" onClick={() => void runAction('uninstall', plugin)}>{pending ? 'Updating…' : 'Uninstall'}</button> : null}
      </footer>
    </article>;
  };

  return <section className="workspace-page workspace-plugins-page">
    <div className="workspace-page-heading"><h1>Plugins</h1><p>Connect Pixel to reviewed capabilities. Installing a plugin is separate from connecting an external account.</p></div>
    <div className="workspace-plugin-notice"><strong>Plugin safety</strong><span>Pixel’s first plugin uses a bundled, declarative tool adapter. Third-party code does not run inside Electron or receive direct filesystem, credential, or native access.</span></div>
    {actionError ? <p className="workspace-plugin-error" role="alert">{actionError}</p> : null}
    <section aria-label="Browse Plugins">
      <h2 className="workspace-section-title">Browse Plugins</h2>
      {available.length ? <div className="workspace-plugin-grid">{available.map(renderPlugin)}</div> : <div className="workspace-empty-card">All plugins in the current catalog are installed.</div>}
    </section>
    <section aria-label="Installed Plugins">
      <h2 className="workspace-section-title mt-6">Installed Plugins</h2>
      {installed.length ? <div className="workspace-plugin-grid">{installed.map(renderPlugin)}</div> : <div className="workspace-empty-card">No plugins installed. Pixel’s built-in tools remain available.</div>}
    </section>
    <ConnectionsAndMcpSection />
  </section>;
}

function ConnectionsAndMcpSection(): React.JSX.Element | null {
  const mcpApi = typeof window !== 'undefined' ? window.cyps?.mcp : undefined;
  const pluginsApi = typeof window !== 'undefined' ? window.cyps?.plugins : undefined;
  const [servers, setServers] = useState<McpServerSummaryView[]>([]);
  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarConnectionStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [serverId, setServerId] = useState('');
  const [serverName, setServerName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    if (mcpApi) {
      try { setServers(await mcpApi.list()); } catch { /* ignore */ }
    }
    if (pluginsApi?.googleCalendarStatus) {
      try { setGcalStatus(await pluginsApi.googleCalendarStatus()); } catch { /* ignore */ }
    }
  };

  useEffect(() => { void reload(); }, []);
  if (!mcpApi) return null;

  const handleAdd = async (): Promise<void> => {
    setError(null);
    try {
      await mcpApi.add({
        id: serverId.trim(),
        name: serverName.trim(),
        transport,
        ...(transport === 'stdio' ? { command: endpoint.trim().split(/\s+/).filter(Boolean) } : { url: endpoint.trim() }),
      });
      setServerId('');
      setServerName('');
      setEndpoint('');
      setAdding(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleServer = async (srv: McpServerSummaryView): Promise<void> => {
    setBusyId(srv.id);
    setError(null);
    try {
      if (srv.enabled) await mcpApi.disable(srv.id);
      else await mcpApi.enable(srv.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-label="Connections and MCP Servers" className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="workspace-section-title">Connections &amp; MCP Servers</h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink)] hover:bg-white/6"
        >
          {adding ? 'Close' : 'Add MCP server'}
        </button>
      </div>

      {gcalStatus ? (
        <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11.5px]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <strong className="text-[var(--color-ink)]">Google Calendar (OAuth 2.0 PKCE)</strong>
              <p className="text-[11px] text-[var(--color-ink-dim)]">
                {gcalStatus.connected
                  ? `Connected · Scopes: ${(gcalStatus.scopes ?? []).join(', ') || 'calendar.readonly'}`
                  : gcalStatus.oauthClientConfigured
                    ? 'Disconnected · OAuth client configured.'
                    : 'Not connected · Configure PIXEL_GOOGLE_OAUTH_CLIENT_ID to authorize live Google Calendar access.'}
              </p>
            </div>
            {gcalStatus.connected && pluginsApi?.googleCalendarDisconnect ? (
              <button
                type="button"
                onClick={() => void pluginsApi.googleCalendarDisconnect!().then(setGcalStatus)}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-ink-soft)]"
              >
                Disconnect
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="workspace-plugin-error mb-2" role="alert">{error}</p> : null}

      {adding ? (
        <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11.5px]">
          <p className="mb-2 text-[11px] text-[var(--color-ink-dim)]">
            External local MCP servers run as separate OS processes without kernel sandboxing. Only add servers you trust.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              aria-label="MCP server id"
              placeholder="server-id (e.g. local-docs)"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]"
            />
            <input
              type="text"
              aria-label="MCP server name"
              placeholder="Display name"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <select
              aria-label="MCP transport"
              value={transport}
              onChange={(e) => setTransport(e.target.value === 'http' ? 'http' : 'stdio')}
              className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]"
            >
              <option value="stdio">Stdio (local process)</option>
              <option value="http">Streamable HTTP (HTTPS)</option>
            </select>
            <input
              type="text"
              aria-label="MCP command or URL"
              placeholder={transport === 'stdio' ? 'python path/to/server.py' : 'https://mcp.example.com/mcp'}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="flex-1 rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]"
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              className="rounded bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-medium text-white"
            >
              Add
            </button>
          </div>
        </div>
      ) : null}

      {servers.length === 0 ? (
        <div className="workspace-empty-card">No external MCP servers configured yet.</div>
      ) : (
        <div className="space-y-2">
          {servers.map((srv) => (
            <div key={srv.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11.5px]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <strong className="text-[var(--color-ink)]">{srv.name}</strong>{' '}
                  <span className="text-[10.5px] text-[var(--color-ink-dim)]">
                    ({srv.id} · {srv.transport} · {srv.status} · {srv.toolCount} tool(s))
                  </span>
                  {srv.lastError ? <p className="mt-0.5 text-[10.5px] text-[var(--color-danger)]">{srv.lastError}</p> : null}
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    disabled={busyId === srv.id}
                    onClick={() => void toggleServer(srv)}
                    className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]"
                  >
                    {busyId === srv.id ? 'Working…' : srv.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === srv.id}
                    onClick={() => void mcpApi.remove(srv.id).then(reload)}
                    className="text-[var(--color-danger)] hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
