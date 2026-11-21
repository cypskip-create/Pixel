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

/** Durable global lifecycle state for bundled, reviewed Pixel plugins. */
export class PluginStore {
  constructor(private readonly db: Database, private readonly manifests: readonly PixelPluginManifest[] = BUNDLED_PLUGINS) {}

  list(): PluginView[] {
    const rows = this.db.query<PluginInstallationRow>('SELECT * FROM plugin_installations');
    const byId = new Map(rows.map((row) => [String(row.plugin_id), row]));
    return this.manifests.map((manifest) => {
      const row = byId.get(manifest.id);
      const compatible = manifest.pixelApiVersion === 1;
      const versionMatches = !row || row.manifest_version === manifest.version;
      return pluginView(manifest, {
        installed: Boolean(row),
        enabled: Boolean(row?.enabled) && compatible && versionMatches,
        updatedAt: row ? Number(row.updated_at) : undefined,
        error: !compatible ? 'This plugin requires an unsupported Pixel plugin API version.' : !versionMatches ? 'Installed version differs from the bundled manifest. Reinstall to update safely.' : row?.last_error ?? undefined,
      });
    });
  }

  manifest(id: string): PixelPluginManifest | undefined {
    return this.manifests.find((item) => item.id === id);
  }

  installedTools(): PixelPluginManifest['tools'] {
    const enabled = new Set(this.list().filter((item) => item.enabled).map((item) => item.id));
    return this.manifests.filter((manifest) => enabled.has(manifest.id)).flatMap((manifest) => manifest.tools);
  }

  install(id: string): void {
    const manifest = this.requireManifest(id);
    const now = Date.now();
    this.db.execute(
      `INSERT INTO plugin_installations (plugin_id, manifest_version, enabled, config_json, installed_at, updated_at, last_error)
       VALUES (?, ?, 0, '{}', ?, ?, NULL)
       ON CONFLICT(plugin_id) DO UPDATE SET manifest_version = excluded.manifest_version,
         enabled = CASE WHEN plugin_installations.manifest_version = excluded.manifest_version THEN plugin_installations.enabled ELSE 0 END,
         updated_at = excluded.updated_at, last_error = NULL`,
      [manifest.id, manifest.version, now, now],
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
