import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(scriptDir, '..');
export const preloadEntry = resolve(projectRoot, 'src', 'preload', 'index.ts');
export const preloadOutput = resolve(projectRoot, 'dist', 'main', 'preload', 'index.js');

/**
 * Electron's sandboxed preload can require Electron's built-in module, but it
 * cannot resolve arbitrary local CommonJS files. Bundle the whole local runtime
 * graph and leave only Electron external. The shared channel registry stays the
 * single source of truth in src/shared/channels.ts.
 */
export function createPreloadBuildOptions(overrides = {}) {
  return {
    entryPoints: [preloadEntry],
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    external: ['electron'],
    outfile: preloadOutput,
    sourcemap: false,
    metafile: true,
    logLevel: 'silent',
    ...overrides,
  };
}

export async function buildPreload(overrides = {}) {
  const options = createPreloadBuildOptions(overrides);
  mkdirSync(dirname(options.outfile ?? preloadOutput), { recursive: true });
  if (options.write !== false) rmSync(`${options.outfile ?? preloadOutput}.map`, { force: true });
  return build(options);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await buildPreload();
  const bundledInputs = Object.keys(result.metafile.inputs).sort();
  console.log(`[preload] Bundled local dependency graph: ${bundledInputs.join(', ')}`);
  console.log(`[preload] Wrote ${preloadOutput}`);
}
