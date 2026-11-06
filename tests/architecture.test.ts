import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../src/shared/channels';
import { SURFACE_SIZES } from '../src/shared/surfaces';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/**
 * These tests guard architectural invariants that are invisible to the type
 * checker but have already caused a real crash once:
 *
 *   ipc.ts imported the preload module to share channel names, which executed
 *   `contextBridge` inside the main process and killed the app at startup.
 */
describe('process boundaries', () => {
  it('no main-process module imports the preload module', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'main'))) {
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*preload[^'"]*['"]/.test(text)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no renderer module imports from the main process', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'renderer'))) {
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*(\.\.\/|@\/)?main\//.test(text) || /from\s+['"]\.\.\/\.\.\/main/.test(text)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the renderer never imports electron directly', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'renderer'))) {
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"]electron['"]/.test(text)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('the renderer never touches ipcRenderer directly', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'renderer'))) {
      if (readFileSync(file, 'utf8').includes('ipcRenderer')) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('only shared types are shared across processes', () => {
    // shared/ must stay free of Electron and Node-only APIs so both processes
    // (and the tests) can import it safely.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'shared'))) {
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"]electron['"]/.test(text) || /from\s+['"]node:/.test(text)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('ipc channels', () => {
  it('are all unique, so a channel cannot be silently shadowed', () => {
    const names = Object.values(CHANNELS);
    expect(new Set(names).size).toBe(names.length);
  });

  it('use a namespaced "area:action" form', () => {
    for (const name of Object.values(CHANNELS)) {
      expect(name).toMatch(/^[a-z]+(:[a-zA-Z]+)+$/);
    }
  });

  it('cover every namespace the bridge exposes', () => {
    const names = Object.values(CHANNELS).join(' ');
    for (const area of [
      'settings:',
      'window:',
      'chat:',
      'history:',
      'screen:',
      'system:',
      'permissions:',
      'tasks:',
      'audit:',
      'app:',
    ]) {
      expect(names).toContain(area);
    }
  });
});

describe('window surface sizes', () => {
  it('keeps every surface small enough to not be a dashboard', () => {
    for (const [surface, size] of Object.entries(SURFACE_SIZES)) {
      expect(size.width, `${surface} width`).toBeLessThanOrEqual(520);
      expect(size.height, `${surface} height`).toBeLessThanOrEqual(520);
    }
  });

  it('expands the input bar to a compact 400-520px width', () => {
    expect(SURFACE_SIZES.active.width).toBeGreaterThanOrEqual(400);
    expect(SURFACE_SIZES.active.width).toBeLessThanOrEqual(520);
  });

  it('keeps the idle orb small', () => {
    expect(SURFACE_SIZES.idle.width).toBeLessThanOrEqual(128);
  });
});
