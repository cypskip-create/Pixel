/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginView } from '../src/shared/types';
import { WorkspacePluginManager } from '../src/renderer/components/WorkspacePluginManager';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(plugins: PluginView[], onChange: (action: 'install' | 'update' | 'uninstall' | 'enable', id: string, enabled?: boolean) => Promise<void>): HTMLDivElement {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root?.render(<WorkspacePluginManager plugins={plugins} onChange={onChange} />));
  return host;
}
function cleanup(): void { if (root) act(() => root?.unmount()); root = null; host?.remove(); host = null; }
afterEach(cleanup);

const catalogPlugin: PluginView = {
  id: 'pixel.github-public', name: 'GitHub public repositories', description: 'Read public metadata.',
  version: '1.0.0', publisher: 'Pixel', capabilities: ['Read repository metadata'],
  permissions: ['HTTPS requests to api.github.com'], installed: false, enabled: false,
  connection: 'not_required', health: 'disabled',
};

describe('Workspace plugin manager', () => {
  it('separates catalog/install state and discloses capabilities and scoped permissions accessibly', () => {
    const installed = { ...catalogPlugin, installed: true, enabled: true, health: 'ready' as const, updatedAt: 1_800_000_000_000 };
    const rendered = mount([catalogPlugin, installed], vi.fn(async () => undefined));
    expect(rendered.querySelector('[aria-label="Browse Plugins"]')?.textContent).toContain(catalogPlugin.name);
    expect(rendered.querySelector('[aria-label="Installed Plugins"]')?.textContent).toContain('Disable');
    expect(rendered.textContent).toContain('No account connection required');
    expect(rendered.textContent).toContain('Updated');
    const details = rendered.querySelector<HTMLDetailsElement>('details.workspace-plugin-permissions');
    expect(details?.querySelector('summary')?.textContent).toContain('Permissions');
    expect(details?.textContent).toContain('HTTPS requests to api.github.com');
  });

  it('prevents repeated lifecycle actions while an operation is in flight', async () => {
    let resolveAction: (() => void) | undefined;
    const onChange = vi.fn(() => new Promise<void>((resolve) => { resolveAction = resolve; }));
    const rendered = mount([catalogPlugin], onChange);
    const install = rendered.querySelector<HTMLButtonElement>('button');
    await act(async () => { install?.click(); install?.click(); await Promise.resolve(); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(install?.disabled).toBe(true);
    expect(rendered.textContent).toContain('Installing…');
    await act(async () => { resolveAction?.(); await Promise.resolve(); });
    expect(install?.disabled).toBe(false);
  });

  it('reports a failed lifecycle change without claiming it succeeded', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    const rendered = mount([catalogPlugin], onChange);
    await act(async () => { rendered.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(rendered.querySelector('[role="alert"]')?.textContent).toContain('could not install');
    expect(rendered.textContent).not.toContain('Installed successfully');
  });

  it('offers a reviewed bundled update and explains that it disables the plugin', async () => {
    const outdated = { ...catalogPlugin, installed: true, enabled: false, health: 'error' as const,
      compatibility: 'update_available' as const, installedVersion: '0.9.0',
      error: 'A reviewed bundled update is available.' };
    const onChange = vi.fn(async () => undefined);
    const rendered = mount([outdated], onChange);
    expect(rendered.textContent).toContain('v0.9.0 → v1.0.0');
    expect(rendered.textContent).toContain('Updating disables this plugin');
    const update = [...rendered.querySelectorAll('button')].find((button) => button.textContent === 'Update');
    await act(async () => { update?.click(); await Promise.resolve(); });
    expect(onChange).toHaveBeenCalledWith('update', outdated.id, undefined);
  });

  it('does not offer a catalog update for an unsupported Pixel API version', () => {
    const incompatible = { ...catalogPlugin, installed: true, enabled: false, health: 'error' as const,
      compatibility: 'unsupported_api' as const, installedVersion: '2.0.0',
      error: 'This plugin requires an unsupported Pixel plugin API version.' };
    const rendered = mount([incompatible], vi.fn(async () => undefined));
    expect(rendered.textContent).toContain('unsupported Pixel plugin API version');
    expect([...rendered.querySelectorAll('button')].some((button) => button.textContent === 'Update')).toBe(false);
  });
});
