import { useRef, useState } from 'react';
import type { PluginView } from '@shared/types';

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
  const pendingLock = useRef(false);
  const available = plugins.filter((plugin) => !plugin.installed);
  const installed = plugins.filter((plugin) => plugin.installed);

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
  </section>;
}
