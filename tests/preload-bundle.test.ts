import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreloadBuildOptions } from '../scripts/build-preload.mjs';

const root = process.cwd();
const preloadSource = readFileSync(`${root}/src/preload/index.ts`, 'utf8');
const windowSource = readFileSync(`${root}/src/main/window.ts`, 'utf8');
const appSource = readFileSync(`${root}/src/main/app.ts`, 'utf8');
const electronRuntimeSource = readFileSync(`${root}/scripts/ensure-electron-runtime.mjs`, 'utf8');
const ciWorkflow = readFileSync(`${root}/.github/workflows/windows-ci.yml`, 'utf8');
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
  scripts: Record<string, string>;
};

describe('sandbox preload bundle', () => {
  it('inlines its complete local runtime graph and keeps only Electron external', async () => {
    const result = await build(createPreloadBuildOptions({
      outfile: 'preload-bundle.test.js',
      write: false,
    }));
    const code = result.outputFiles?.[0]?.text ?? '';
    const runtimeRequires = [...code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((match) => match[1]);
    const bundledInputs = Object.keys(result.metafile?.inputs ?? {}).map((path) => path.replace(/\\/g, '/'));

    expect(result.outputFiles).toHaveLength(1);
    expect(result.metafile).toBeDefined();
    expect(runtimeRequires).toEqual(['electron']);
    expect(bundledInputs).toContain('src/preload/index.ts');
    expect(bundledInputs).toContain('src/shared/channels.ts');
    expect(bundledInputs).toHaveLength(2);
    expect(code).toContain('settings:get');
    expect(code).toContain('tasks:update');
    expect(code).toContain('permissions:request');
  });

  it('preserves both narrow bridge surfaces and does not add a raw IPC export', async () => {
    const result = await build(createPreloadBuildOptions({
      outfile: 'preload-bridge.test.js',
      write: false,
    }));
    const code = result.outputFiles?.[0]?.text ?? '';
    expect(result.outputFiles).toHaveLength(1);

    expect(code).toContain('cyps');
    expect(code).toContain('cypsShell');
    expect(code).toContain('voiceCapability');
    expect(code).toContain('exposeInMainWorld');
    expect(code).not.toMatch(/exposeInMainWorld\([^,]+,\s*(?:ipcRenderer|require|process)\b/);

    const exposedGlobals = [...preloadSource.matchAll(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1]);
    expect(exposedGlobals).toEqual(['cyps', 'cypsShell']);
  });

  it('writes the bundled file at the path used by each secure companion window', () => {
    expect(appSource).toContain("join(mainDir(), '..', 'preload', 'index.js')");
    expect(windowSource).toContain("join(mainDir, '..', 'preload', 'index.js')");
    expect([...windowSource.matchAll(/contextIsolation: true/g)]).toHaveLength(4);
    expect([...windowSource.matchAll(/nodeIntegration: false/g)]).toHaveLength(4);
    expect([...windowSource.matchAll(/sandbox: true/g)]).toHaveLength(4);
    expect([...windowSource.matchAll(/webSecurity: true/g)]).toHaveLength(4);
    expect(windowSource).toContain('focusable: false');
    expect(windowSource).toContain('win.setIgnoreMouseEvents(true, { forward: true })');
    expect(windowSource).toContain("this.loadRenderer(win, '?window=workspace')");
  });

  it('runs the bundler for development, builds and Windows packaging', () => {
    expect(packageJson.scripts['build:main']).toContain('node scripts/build-preload.mjs');
    expect(packageJson.scripts['dev:electron']).toContain('npm run build:main');
    expect(packageJson.scripts.build).toContain('npm run build:main');
    expect(packageJson.scripts.pack).toContain('npm run build');
    expect(packageJson.scripts.dist).toContain('npm run build');
    expect(packageJson.scripts.build).toContain('node scripts/make-icon.mjs');
    expect(packageJson.scripts['ensure:electron-runtime']).toContain('ensure-electron-runtime.mjs');
    expect(electronRuntimeSource).toContain("process.versions.electron");
    expect(electronRuntimeSource).toContain("resolve(electronPackage, 'dist', 'electron.exe')");
    expect(ciWorkflow).toContain('npm run ensure:electron-runtime');
    expect(ciWorkflow).toContain('actions/upload-artifact@v4');
  });
});
