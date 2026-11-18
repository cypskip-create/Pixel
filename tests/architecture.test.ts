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
      'browser:',
      'screen:',
      'system:',
      'workspace:',
      'permissions:',
      'tasks:',
      'audit:',
      'app:',
    ]) {
      expect(names).toContain(area);
    }
  });
});

describe('shared Pixel Workspace', () => {
  it('opens as a second secured renderer window that reuses the main-process agent', () => {
    const app = readFileSync(join(SRC, 'renderer', 'App.tsx'), 'utf8');
    const workspace = readFileSync(join(SRC, 'renderer', 'Workspace.tsx'), 'utf8');
    const windowManager = readFileSync(join(SRC, 'main', 'window.ts'), 'utf8');
    const ipc = readFileSync(join(SRC, 'main', 'ipc.ts'), 'utf8');
    const preload = readFileSync(join(SRC, 'preload', 'index.ts'), 'utf8');

    expect(app).toContain("get('window') === 'workspace'");
    expect(windowManager).toContain("this.loadRenderer(win, '?window=workspace')");
    expect(windowManager).toContain('contextIsolation: true');
    expect(windowManager).toContain('nodeIntegration: false');
    expect(windowManager).toContain('sandbox: true');
    expect(windowManager).toContain('webSecurity: true');
    expect(workspace).toContain('history.list');
    expect(workspace).toContain('api.onRequest');
    expect(workspace).toContain('system.emergencyStop');
    expect(ipc).toContain('if (agent.isRunning) throw new Error');
    expect(ipc).toContain('conversationId ? { conversationId }');
    expect(ipc).toContain('isTrustedApplicationSender(event.sender, event.senderFrame)');
    expect(preload).toContain('workspaceToggleMaximize');
    expect(preload).toContain('workspaceSetFullscreen');
    expect(preload).not.toContain("contextBridge.exposeInMainWorld('electron'");
  });

  it('starts in the conversation-first Workspace without exposing a stale activity panel', () => {
    const workspace = readFileSync(join(SRC, 'renderer', 'Workspace.tsx'), 'utf8');
    const header = readFileSync(join(SRC, 'renderer', 'components', 'WorkspaceConversationHeader.tsx'), 'utf8');
    const styles = readFileSync(join(SRC, 'renderer', 'index.css'), 'utf8');
    expect(workspace).toContain("useState<WorkspaceView>('chat')");
    expect(workspace).toContain('useState(false)');
    expect(workspace).toContain('selectActiveTask(tasks)');
    expect(header).toContain('<CompactModeSelector');
    expect(workspace).toContain('<WorkspaceComposer');
    expect(workspace).toContain('<WorkspaceSidebar');
    expect(workspace).toContain('onOpenTaskDetails={() => setContextOpen(true)}');
    expect(workspace).toContain('system.emergencyStop');
    expect(workspace).not.toContain('variant="inline"');
    expect(workspace).not.toContain('window.prompt');
    expect(styles).toContain('--workspace-surface: #151c28');
    expect(styles).toContain('--workspace-panel: #1c2635');
    expect(styles).toContain('--workspace-panel-solid: #243144');
    expect(styles).toContain('--workspace-hover: #2c3b51');
    expect(styles).toContain('background: var(--workspace-panel-solid)');
  });
});

describe('chat history and browser search trust boundaries', () => {
  it('keeps model history main-owned and bounded to sanitized user-facing records', () => {
    const ipc = readFileSync(join(SRC, 'main', 'ipc.ts'), 'utf8');
    const store = readFileSync(join(SRC, 'main', 'history', 'store.ts'), 'utf8');
    expect(ipc).toContain('const { history: _rendererHistory, conversationId: _rendererConversationId');
    expect(ipc).toContain('history: priorHistory');
    expect(ipc).toContain("message.role === 'user' || message.role === 'assistant'");
    expect(ipc).toContain('current.privacy.persistHistory');
    expect(store).toContain("if (record.persistence === 'session') return");
    expect(store).toContain('redactTaskText');
  });

  it('builds browser search URLs in main from a bounded query and the selected provider', () => {
    const ipc = readFileSync(join(SRC, 'main', 'ipc.ts'), 'utf8');
    const search = readFileSync(join(SRC, 'shared', 'browserSearch.ts'), 'utf8');
    expect(ipc).toContain('CHANNELS.browserOpenSearch');
    expect(ipc).toContain('createSearchUrl(queryValue, provider)');
    expect(ipc).toContain('shell.openExternal(safeUrl)');
    expect(ipc).toContain('safeExternalHttpUrl(url)');
    expect(search).toContain('MAX_SEARCH_QUERY_LENGTH = 500');
    expect(search).toContain("'https://www.google.com/search'");
    expect(search).toContain("'https://www.bing.com/search'");
    expect(search).toContain("'https://duckduckgo.com/'");
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

  it('keeps the idle pill compact and thin', () => {
    expect(SURFACE_SIZES.idle).toEqual({ width: 144, height: 52 });
    expect(SURFACE_SIZES.idle.width).toBeLessThanOrEqual(155);
    expect(SURFACE_SIZES.idle.height).toBeLessThanOrEqual(54);
  });
});

describe('central companion panel presentation', () => {
  it('mounts the operating mode popover only from InputBar', () => {
    const app = readFileSync(join(SRC, 'renderer', 'App.tsx'), 'utf8');
    const inputBar = readFileSync(join(SRC, 'renderer', 'components', 'InputBar.tsx'), 'utf8');
    expect(app).not.toMatch(/<ModeSwitcher\b/);
    expect(inputBar.match(/<ModeSwitcher\b/g)).toHaveLength(1);
  });

  it('reports fixed per-surface geometry and routes it through the bridge', () => {
    const hook = readFileSync(join(SRC, 'renderer', 'hooks', 'usePresentationLayout.ts'), 'utf8');
    const windowSource = readFileSync(join(SRC, 'main', 'window.ts'), 'utf8');
    const ipcSource = readFileSync(join(SRC, 'main', 'ipc.ts'), 'utf8');
    expect(hook).toContain('SURFACE_SIZES[surface]');
    expect(hook).not.toMatch(/new\s+ResizeObserver/);
    expect(hook).not.toMatch(/new\s+MutationObserver/);
    expect(hook).not.toMatch(/\.scrollHeight|\.scrollWidth/);
    expect(hook).toContain('setLayout(surface');
    expect(windowSource).toContain('fitPresentationSize(requestedSize');
    expect(windowSource).toContain('CHANNELS.windowFocusLost');
    expect(ipcSource).toContain('CHANNELS.windowSetLayout');
  });

  it('anchors the primary bar and keeps cursor following in a passive second window', () => {
    const windowSource = readFileSync(join(SRC, 'main', 'window.ts'), 'utf8');
    const appSource = readFileSync(join(SRC, 'renderer', 'App.tsx'), 'utf8');
    const channels = Object.keys(CHANNELS).join(' ');
    expect(windowSource).toContain('movable: false');
    expect(windowSource).toContain('anchoredTopCenterBounds');
    expect(windowSource).toContain('focusable: false');
    expect(windowSource).toContain('win.setIgnoreMouseEvents(true, { forward: true })');
    expect(windowSource).toContain("'?window=cursor'");
    expect(appSource).toContain('function CursorCompanionWindow()');
    expect(channels).not.toContain('windowSetPosition');
    expect(channels).not.toContain('windowGetPosition');
  });
});
