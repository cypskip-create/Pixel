import type { Database } from '../data/database';
import { BUNDLED_PLUGINS, pluginView } from './manifest';
import type { PixelPluginManifest } from './manifest';
import type { PluginView } from '../../shared/types';

interface PluginInstallationRow {
  plugin_id: string;
  manifest_version: string;
  enabled: number;
  config_json: string;
  installed_at: number;
  updated_at: number;
  last_error: string | null;
}

interface ProjectAvailabilityRow {
  availability: 'enabled' | 'disabled';
}

/** Durable global lifecycle state for bundled, reviewed Pixel plugins. */
export class PluginStore {
  constructor(private readonly db: Database, private readonly manifests: readonly PixelPluginManifest[] = BUNDLED_PLUGINS) {}

  list(projectId?: string): PluginView[] {
    const rows = this.db.query<PluginInstallationRow>('SELECT * FROM plugin_installations');
    const byId = new Map(rows.map((row) => [String(row.plugin_id), row]));
    return this.manifests.map((manifest) => {
      const row = byId.get(manifest.id);
      const apiCompatible = manifest.pixelApiVersion === 1;
      const versionMatches = !row || row.manifest_version === manifest.version;
      const globallyEnabled = Boolean(row?.enabled) && apiCompatible && versionMatches;
      const override = projectId
        ? this.projectAvailability(manifest.id, projectId)
        : 'inherit';
      const config = parsePluginSettings(manifest, row?.config_json);
      return pluginView(manifest, {
        installed: Boolean(row),
        enabled: globallyEnabled,
        availableInProject: globallyEnabled && override !== 'disabled',
        projectAvailability: override,
        compatibility: !row ? 'not_installed' : !apiCompatible ? 'unsupported_api' : !versionMatches ? 'update_available' : 'compatible',
        installedVersion: row?.manifest_version,
        updatedAt: row ? Number(row.updated_at) : undefined,
        error: !apiCompatible ? 'This plugin requires an unsupported Pixel plugin API version.' : !versionMatches ? 'A reviewed bundled update is available. Updating will disable the plugin until you enable it again.' : row?.last_error ?? undefined,
        settings: (manifest.settings ?? []).map((setting) => ({
          key: setting.key, label: setting.label, description: setting.description,
          value: config[setting.key] ?? setting.defaultValue,
          options: setting.options.map((option) => ({ ...option })),
        })),
      });
    });
  }

  manifest(id: string): PixelPluginManifest | undefined {
    return this.manifests.find((item) => item.id === id);
  }

  getSetting(pluginId: string, key: string): string | undefined {
    const manifest = this.manifest(pluginId);
    const row = this.db.queryOne<PluginInstallationRow>('SELECT * FROM plugin_installations WHERE plugin_id = ?', [pluginId]);
    if (!manifest || !row) return undefined;
    return parsePluginSettings(manifest, row.config_json)[key]
      ?? manifest.settings?.find((setting) => setting.key === key)?.defaultValue;
  }

  setSetting(pluginId: string, key: string, value: string): void {
    const manifest = this.requireManifest(pluginId);
    const row = this.db.queryOne<PluginInstallationRow>('SELECT * FROM plugin_installations WHERE plugin_id = ?', [pluginId]);
    if (!row) throw new Error('Install this plugin before changing its settings.');
    if (manifest.pixelApiVersion !== 1 || row.manifest_version !== manifest.version) {
      throw new Error('Update this plugin to a compatible version before changing its settings.');
    }
    const definition = manifest.settings?.find((setting) => setting.key === key);
    if (!definition) throw new Error('That setting is not declared by this plugin manifest.');
    if (typeof value !== 'string' || !definition.options.some((option) => option.value === value)) {
      throw new Error('Choose one of the values declared by this plugin setting.');
    }
    const config = parsePluginSettings(manifest, row.config_json);
    config[key] = value;
    this.db.execute('UPDATE plugin_installations SET config_json = ?, updated_at = ? WHERE plugin_id = ?', [JSON.stringify(config), Date.now(), pluginId]);
    const saved = this.db.queryOne<PluginInstallationRow>('SELECT * FROM plugin_installations WHERE plugin_id = ?', [pluginId]);
    if (!saved || parsePluginSettings(manifest, saved.config_json)[key] !== value) {
      throw new Error('The plugin setting was not present after saving.');
    }
  }

  installedTools(): PixelPluginManifest['tools'] {
    const enabled = new Set(this.list().filter((item) => item.enabled).map((item) => item.id));
    return this.manifests.filter((manifest) => enabled.has(manifest.id)).flatMap((manifest) => manifest.tools);
  }

  /** Whether a registered plugin tool is available in one project. Core tools are unaffected. */
  isToolAvailable(projectId: string, toolName: string): boolean {
    const manifest = this.manifests.find((candidate) => candidate.tools.some((tool) => tool.name === toolName));
    if (!manifest) return true;
    const row = this.db.queryOne<PluginInstallationRow>('SELECT * FROM plugin_installations WHERE plugin_id = ?', [manifest.id]);
    if (!row || row.enabled !== 1 || row.manifest_version !== manifest.version || manifest.pixelApiVersion !== 1) return false;
    return this.projectAvailability(manifest.id, projectId) !== 'disabled';
  }

  setProjectAvailability(pluginId: string, projectId: string, availability: 'inherit' | 'enabled' | 'disabled'): void {
    this.requireManifest(pluginId);
    if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 200) {
      throw new Error('A valid Pixel project is required.');
    }
    if (!['inherit', 'enabled', 'disabled'].includes(availability)) {
      throw new Error('Project plugin availability must be inherit, enabled, or disabled.');
    }
    const installed = this.db.queryOne<{ plugin_id: string }>(
      'SELECT plugin_id FROM plugin_installations WHERE plugin_id = ?', [pluginId],
    );
    if (!installed) throw new Error('Install this plugin before changing project availability.');
    if (availability === 'inherit') {
      this.db.execute('DELETE FROM plugin_project_availability WHERE plugin_id = ? AND project_id = ?', [pluginId, projectId]);
      return;
    }
    const now = Date.now();
    this.db.execute(
      `INSERT INTO plugin_project_availability (plugin_id, project_id, availability, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(plugin_id, project_id) DO UPDATE SET availability = excluded.availability, updated_at = excluded.updated_at`,
      [pluginId, projectId, availability, now],
    );
  }

  private projectAvailability(pluginId: string, projectId: string): 'inherit' | 'enabled' | 'disabled' {
    if (!projectId) return 'inherit';
    const row = this.db.queryOne<ProjectAvailabilityRow>(
      'SELECT availability FROM plugin_project_availability WHERE plugin_id = ? AND project_id = ?',
      [pluginId, projectId],
    );
    return row?.availability ?? 'inherit';
  }

  install(id: string): void {
    const manifest = this.requireManifest(id);
    const existing = this.db.queryOne<PluginInstallationRow>('SELECT * FROM plugin_installations WHERE plugin_id = ?', [id]);
    if (existing) {
      if (existing.manifest_version !== manifest.version) throw new Error('Use the reviewed plugin update action for an installed version mismatch.');
      return;
    }
    const now = Date.now();
    this.db.execute(
      `INSERT INTO plugin_installations (plugin_id, manifest_version, enabled, config_json, installed_at, updated_at, last_error)
       VALUES (?, ?, 0, '{}', ?, ?, NULL)`,
      [manifest.id, manifest.version, now, now],
    );
  }

  update(id: string): void {
    const manifest = this.requireManifest(id);
    if (manifest.pixelApiVersion !== 1) throw new Error('This plugin targets an unsupported Pixel plugin API version.');
    const row = this.db.queryOne<PluginInstallationRow>('SELECT * FROM plugin_installations WHERE plugin_id = ?', [id]);
    if (!row) throw new Error('Install this plugin before updating it.');
    if (row.manifest_version === manifest.version) throw new Error('This plugin already has the current bundled version.');
    this.db.execute(
      'UPDATE plugin_installations SET manifest_version = ?, enabled = 0, updated_at = ?, last_error = NULL WHERE plugin_id = ?',
      [manifest.version, Date.now(), id],
    );
  }

  uninstall(id: string): void {
    this.requireManifest(id);
    this.db.execute('DELETE FROM plugin_installations WHERE plugin_id = ?', [id]);
  }

  setEnabled(id: string, enabled: boolean): void {
    const manifest = this.requireManifest(id);
    const row = this.db.queryOne<PluginInstallationRow>('SELECT * FROM plugin_installations WHERE plugin_id = ?', [id]);
    if (!row) throw new Error('Install this plugin before enabling it.');
    if (manifest.pixelApiVersion !== 1 || row.manifest_version !== manifest.version) throw new Error('Reinstall the plugin to use a compatible version.');
    this.db.execute('UPDATE plugin_installations SET enabled = ?, updated_at = ?, last_error = NULL WHERE plugin_id = ?', [enabled ? 1 : 0, Date.now(), id]);
  }

  recordHealth(id: string, error?: string): void {
    if (!this.manifest(id)) return;
    this.db.execute('UPDATE plugin_installations SET updated_at = ?, last_error = ? WHERE plugin_id = ?', [Date.now(), error ? error.replace(/[\r\n\0]+/g, ' ').slice(0, 300) : null, id]);
  }

  private requireManifest(id: string): PixelPluginManifest {
    const manifest = this.manifest(id);
    if (!manifest) throw new Error('This plugin is not in Pixel’s reviewed catalog.');
    return manifest;
  }
}

/** Only declared enum choices survive reads; config JSON can never contain credentials or arbitrary objects. */
function parsePluginSettings(manifest: PixelPluginManifest, raw?: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const candidate = parsed as Record<string, unknown>;
  const accepted: Record<string, string> = {};
  for (const setting of manifest.settings ?? []) {
    const value = candidate[setting.key];
    if (typeof value === 'string' && setting.options.some((option) => option.value === value)) accepted[setting.key] = value;
  }
  return accepted;
}
