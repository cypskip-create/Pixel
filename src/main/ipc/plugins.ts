import { CHANNELS } from '../../shared/channels';
import type {
  GitHubConnectionStatus,
  GoogleCalendarConnectionStatus,
  McpServerSummaryView,
  PluginView,
} from '../../shared/types';
import type { AuditLog, PermissionBroker } from '../agent/runtime';
import type { ToolRegistry } from '../agent/tools';
import type { McpServerManager } from '../plugins/mcpManager';
import type { PluginStore } from '../plugins/store';
import { verifyGitHubToken } from '../plugins/github';
import type { SettingsStore } from '../settings';
import type { IpcRegistrar } from './registry';

export interface PluginIpcDeps {
  registrar: IpcRegistrar;
  projectId: () => string;
  pluginStore: PluginStore;
  toolRegistry: ToolRegistry;
  permissions: PermissionBroker;
  audit: AuditLog;
  settings: SettingsStore;
  mcpManager: McpServerManager;
  readGoogleCalendarToken: () => { accessToken: string; scopes: string[]; expiresAt: number } | null;
}

export function registerPluginIpc(deps: PluginIpcDeps): void {
  const {
    registrar,
    projectId,
    pluginStore,
    toolRegistry,
    permissions,
    audit,
    settings,
    mcpManager,
    readGoogleCalendarToken,
  } = deps;

  const revokePluginPermissions = (
    pluginId: string,
    manifest: ReturnType<typeof pluginStore.manifest>,
  ): void => {
    if (!manifest) return;
    for (const tool of manifest.tools) permissions.revokeForTool(tool.name);
    audit.record(
      'system',
      `Cleared permissions for Pixel plugin ${pluginId}`,
      'ok',
      'Pending approvals and stored grants were revoked.',
    );
  };

  registrar.registerHandler(CHANNELS.pluginsList, (): PluginView[] => pluginStore.list(projectId()));

  registrar.registerHandler(CHANNELS.pluginsInstall, (_event, pluginId: string): PluginView[] => {
    pluginStore.install(pluginId);
    audit.record('system', `Installed Pixel plugin ${pluginId}`, 'ok', 'Bundled, declarative plugin; no external code was executed.');
    return pluginStore.list(projectId());
  });

  registrar.registerHandler(CHANNELS.pluginsUpdate, (_event, pluginId: string): PluginView[] => {
    const manifest = pluginStore.manifest(pluginId);
    if (!manifest) throw new Error('This plugin is not in Pixel’s reviewed catalog.');
    pluginStore.update(pluginId);
    revokePluginPermissions(pluginId, manifest);
    for (const tool of manifest.tools) toolRegistry.unregister(tool.name);
    audit.record('system', `Updated Pixel plugin ${pluginId}`, 'ok', 'Updated from the bundled reviewed manifest; plugin remains disabled pending explicit re-enable.');
    return pluginStore.list(projectId());
  });

  registrar.registerHandler(CHANNELS.pluginsUninstall, (_event, pluginId: string): PluginView[] => {
    const manifest = pluginStore.manifest(pluginId);
    revokePluginPermissions(pluginId, manifest);
    pluginStore.uninstall(pluginId);
    if (manifest) for (const tool of manifest.tools) toolRegistry.unregister(tool.name);
    audit.record('system', `Uninstalled Pixel plugin ${pluginId}`, 'ok');
    return pluginStore.list(projectId());
  });

  registrar.registerHandler(CHANNELS.pluginsSetEnabled, (_event, pluginId: string, enabled: boolean): PluginView[] => {
    if (typeof enabled !== 'boolean') throw new Error('Plugin enabled state must be true or false.');
    const manifest = pluginStore.manifest(pluginId);
    if (!manifest) throw new Error('This plugin is not in Pixel’s reviewed catalog.');
    if (enabled) {
      const current = pluginStore.list(projectId()).find((item) => item.id === pluginId);
      if (current?.enabled) return pluginStore.list(projectId());
      for (const tool of manifest.tools) {
        const existing = toolRegistry.get(tool.name);
        if (existing) {
          throw new Error(`Plugin tool name conflicts with an existing Pixel capability: ${tool.name}`);
        }
      }
    }
    if (!enabled) revokePluginPermissions(pluginId, manifest);
    pluginStore.setEnabled(pluginId, enabled);
    for (const tool of manifest.tools) {
      if (enabled) toolRegistry.register(tool);
      else toolRegistry.unregister(tool.name);
    }
    audit.record('system', `${enabled ? 'Enabled' : 'Disabled'} Pixel plugin ${pluginId}`, 'ok', `Registered tools: ${manifest.tools.map((tool) => tool.name).join(', ')}`);
    return pluginStore.list(projectId());
  });

  registrar.registerHandler(
    CHANNELS.pluginsSetProjectAvailability,
    (_event, pluginId: string, availability: 'inherit' | 'enabled' | 'disabled'): PluginView[] => {
      const manifest = pluginStore.manifest(pluginId);
      if (!manifest) throw new Error('This plugin is not in Pixel’s reviewed catalog.');
      pluginStore.setProjectAvailability(pluginId, projectId(), availability);
      revokePluginPermissions(pluginId, manifest);
      audit.record('system', `Changed project plugin availability for ${pluginId}`, 'ok', `Project ${projectId()}; setting ${availability}; existing grants cleared.`);
      return pluginStore.list(projectId());
    },
  );

  registrar.registerHandler(CHANNELS.pluginsSetSetting, (_event, pluginId: string, key: string, value: string): PluginView[] => {
    pluginStore.setSetting(pluginId, key, value);
    audit.record('system', `Changed a setting for Pixel plugin ${pluginId}`, 'ok', `Setting ${key} was changed through its reviewed manifest.`);
    return pluginStore.list(projectId());
  });

  registrar.registerHandler(CHANNELS.pluginsGitHubStatus, async (): Promise<GitHubConnectionStatus> => {
    const encryptionAvailable = settings.isEncryptionAvailable();
    const token = settings.getGitHubToken();
    if (!token) return { connected: false, encryptionAvailable };
    try {
      const profile = await verifyGitHubToken(token);
      return {
        connected: true,
        encryptionAvailable,
        verified: true,
        login: profile.login,
        name: profile.name,
        scopes: profile.scopes,
      };
    } catch (error) {
      return {
        connected: true,
        encryptionAvailable,
        verified: false,
        error: error instanceof Error ? error.message : 'Unable to verify GitHub token.',
      };
    }
  });

  registrar.registerHandler(CHANNELS.pluginsGitHubConnect, async (_event, tokenValue: unknown): Promise<GitHubConnectionStatus> => {
    const encryptionAvailable = settings.isEncryptionAvailable();
    const token = typeof tokenValue === 'string' ? tokenValue.trim() : '';
    if (!token) return { connected: false, encryptionAvailable, error: 'Enter a GitHub personal access token.' };
    try {
      const profile = await verifyGitHubToken(token);
      const saved = settings.setGitHubToken(token);
      if (!saved.ok) {
        return { connected: false, encryptionAvailable, error: saved.error ?? 'Could not store GitHub token.' };
      }
      audit.record('system', 'Connected GitHub account', 'ok', `@${profile.login} · scopes: ${profile.scopes.join(', ') || 'fine-grained'}`);
      return {
        connected: true,
        encryptionAvailable,
        verified: true,
        login: profile.login,
        name: profile.name,
        scopes: profile.scopes,
      };
    } catch (error) {
      audit.record('system', 'GitHub account connection failed', 'error');
      return {
        connected: false,
        encryptionAvailable,
        verified: false,
        error: error instanceof Error ? error.message : 'GitHub token verification failed.',
      };
    }
  });

  registrar.registerHandler(CHANNELS.pluginsGitHubDisconnect, (): GitHubConnectionStatus => {
    settings.clearGitHubToken();
    audit.record('system', 'Disconnected local GitHub token', 'ok', 'Removed encrypted local token; revoke on github.com separately if desired.');
    return { connected: false, encryptionAvailable: settings.isEncryptionAvailable() };
  });

  /* ----------------------- MCP & Google Calendar --------------------- */

  registrar.registerHandler(CHANNELS.mcpServersList, (): McpServerSummaryView[] =>
    mcpManager.listServers(),
  );
  registrar.registerHandler(CHANNELS.mcpServersAdd, (_event, input: Parameters<McpServerManager['addServer']>[0]): McpServerSummaryView => {
    const created = mcpManager.addServer(input);
    audit.record('system', `Added MCP server ${created.id} (${created.transport})`, 'ok', created.trustTier);
    return created;
  });
  registrar.registerHandler(CHANNELS.mcpServersEnable, async (_event, id: string): Promise<McpServerSummaryView> => {
    const view = await mcpManager.enableServer(id);
    audit.record('system', `Enabled MCP server ${id}`, 'ok', `${view.toolCount} tool(s) discovered`);
    return view;
  });
  registrar.registerHandler(CHANNELS.mcpServersDisable, async (_event, id: string): Promise<McpServerSummaryView> => {
    const view = await mcpManager.disableServer(id);
    audit.record('system', `Disabled MCP server ${id}`, 'ok', 'Connections closed and tool grants revoked.');
    return view;
  });
  registrar.registerHandler(CHANNELS.mcpServersSetProjects, (_event, id: string, allowedProjects: string[]): McpServerSummaryView => {
    const view = mcpManager.setAllowedProjects(id, allowedProjects);
    audit.record('system', `Updated project scope for MCP server ${id}`, 'ok', view.allowedProjects.join(', '));
    return view;
  });
  registrar.registerHandler(CHANNELS.mcpServersRemove, async (_event, id: string): Promise<boolean> => {
    const removed = await mcpManager.removeServer(id);
    if (removed) audit.record('system', `Removed MCP server ${id}`, 'ok');
    return removed;
  });
  registrar.registerHandler(CHANNELS.googleCalendarStatus, (): GoogleCalendarConnectionStatus => {
    const token = readGoogleCalendarToken();
    const oauthClientConfigured = Boolean(process.env.PIXEL_GOOGLE_OAUTH_CLIENT_ID?.trim());
    return {
      connected: Boolean(token),
      encryptionAvailable: settings.isEncryptionAvailable(),
      oauthClientConfigured,
      ...(token ? { scopes: token.scopes, expiresAt: token.expiresAt } : {}),
    };
  });
  registrar.registerHandler(CHANNELS.googleCalendarDisconnect, (): GoogleCalendarConnectionStatus => {
    settings.clearProviderSecret('google-calendar');
    audit.record('system', 'Disconnected local Google Calendar OAuth credentials', 'ok');
    return {
      connected: false,
      encryptionAvailable: settings.isEncryptionAvailable(),
      oauthClientConfigured: Boolean(process.env.PIXEL_GOOGLE_OAUTH_CLIENT_ID?.trim()),
    };
  });
}
