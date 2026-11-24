import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, PROVIDER_IDS } from '../src/shared/types';
import { TerminalService } from '../src/main/services/terminalService';
import { ToolExecutors } from '../src/main/agent/executors';
import { BrowserSession, BrowserSessionManager } from '../src/main/agent/browser';
import { ComputerUseController } from '../src/main/agent/computerUse';
import { VOICE_MODEL_CATALOG } from '../src/main/voice/models';
import { VoiceService } from '../src/main/voice/voice';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';

import { deflateSync } from 'node:zlib';

function makeMinimalWav(): Uint8Array {
  // Valid 44-byte header + 16000 bytes (500ms mono 16kHz 16-bit PCM)
  const dataLen = 16000;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  return new Uint8Array(buf);
}

function makeTestPngBase64(width = 80, height = 60): string {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (b: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4), 240);
  for (let y = 0; y < height; y++) raw[y * (1 + width * 4)] = 0;
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

describe('Python-First Runtime & Stage 4-6 Production Integration', () => {
  it('promotes Python to the default agent runtime and defines dedicated FAL provider slot', () => {
    expect(DEFAULT_SETTINGS.agent.runtimeEngine).toBe('python');
    expect(PROVIDER_IDS).toContain('fal');
  });

  it('enforces fail-closed process ownership across ToolExecutors and supports persistent shells', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-s4-'));
    const terminal = new TerminalService({ authorizedRoot: dir });
    const executors = new ToolExecutors({ terminal });
    try {
      // Conversation A opens a persistent shell
      const opened = await executors.run(
        'terminal_open',
        { shell: process.platform === 'win32' ? 'cmd' : 'sh', cols: 100, rows: 30 },
        undefined,
        { taskId: 't1', ownerId: 'conv-A' },
      );
      expect(opened.ok).toBe(true);
      const sessionId = String((opened.detail as { id?: string })?.id ?? '');
      expect(sessionId).toMatch(/^shell_/);

      // Conversation B is DENIED read/write/resize/kill on Conversation A's shell
      const bRead = await executors.run('terminal_read', { sessionId }, undefined, { taskId: 't2', ownerId: 'conv-B' });
      expect(bRead.ok).toBe(false);

      const bWrite = await executors.run('terminal_write', { sessionId, input: 'echo hijack\n' }, undefined, { taskId: 't2', ownerId: 'conv-B' });
      expect(bWrite.ok).toBe(false);

      const bKill = await executors.run('process_kill', { sessionId }, undefined, { taskId: 't2', ownerId: 'conv-B' });
      expect(bKill.ok).toBe(false);

      // Direct TerminalService call with missing ownerId is ALSO denied (fail-closed!)
      expect(terminal.get(sessionId, undefined)).toBeNull();
      expect(terminal.writeStdin(sessionId, 'nope\n', undefined).ok).toBe(false);

      // Conversation A can resize, write, read, and close its own shell
      const resized = await executors.run('terminal_resize', { sessionId, cols: 132, rows: 40 }, undefined, { taskId: 't1', ownerId: 'conv-A' });
      expect(resized.ok).toBe(true);
      const closed = await executors.run('terminal_close', { sessionId }, undefined, { taskId: 't1', ownerId: 'conv-A' });
      expect(closed.ok).toBe(true);
    } finally {
      terminal.adminKillAll();
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Best-effort temp dir cleanup on Windows.
      }
    }
  });

  it('supports BrowserSessionManager isolation, real launchPersistentContext, and non-destructive CDP existing-context attach', async () => {
    const profileRoot = mkdtempSync(join(tmpdir(), 'pixel-prof-'));
    try {
      const persistentCalls: string[] = [];
      let cdpBrowserClosed = false;
      let cdpExistingContextClosed = false;

      const fakePage = {
        goto: vi.fn(async () => ({})),
        url: () => 'https://example.com',
        title: async () => 'Example',
        innerText: async () => 'Hello',
        $$eval: async () => [],
        click: async () => undefined,
        fill: async () => undefined,
        press: async () => undefined,
        locator: () => ({} as never),
        getByRole: () => ({} as never),
        getByLabel: () => ({} as never),
        getByPlaceholder: () => ({} as never),
        getByText: () => ({} as never),
        waitForEvent: async () => ({} as never),
        waitForSelector: async () => ({}),
        screenshot: async () => Buffer.from(''),
        evaluate: async () => undefined as never,
        isClosed: () => false,
      };

      const fakePersistentContext = {
        newPage: async () => fakePage,
        pages: () => [fakePage],
        route: async () => undefined,
        close: async () => undefined,
      };

      // 1. Persistent profile mode invokes launchPersistentContext
      const persistentSession = new BrowserSession({
        sessionId: 'conv-persist',
        persistentProfilesRoot: profileRoot,
        getSettings: () => ({ ...DEFAULT_SETTINGS.browser, profileMode: 'pixel_persistent_profile' }),
        playwrightLoader: async () => ({
          chromium: {
            launch: async () => { throw new Error('Should not call launch() in persistent mode'); },
            launchPersistentContext: async (userDataDir) => {
              persistentCalls.push(userDataDir);
              return fakePersistentContext;
            },
          },
        }),
      });
      await persistentSession.listTabs();
      expect(persistentCalls.length).toBe(1);
      expect(persistentSession.mode).toBe('pixel_persistent');
      await persistentSession.close();

      // 2. CDP attach reuses existing authorized context & tabs and NEVER closes user's context/browser
      const cdpSession = new BrowserSession({
        sessionId: 'conv-cdp',
        getSettings: () => ({ ...DEFAULT_SETTINGS.browser, cdpEndpoint: 'http://127.0.0.1:9222' }),
        playwrightLoader: async () => ({
          chromium: {
            launch: async () => { throw new Error('Should not launch when CDP is set'); },
            connectOverCDP: async () => ({
              contexts: () => [
                {
                  newPage: async () => fakePage,
                  pages: () => [fakePage],
                  route: async () => undefined,
                  close: async () => { cdpExistingContextClosed = true; },
                },
              ],
              newContext: async () => { throw new Error('Should reuse existing authorized context'); },
              close: async () => { cdpBrowserClosed = true; },
            }),
          },
        }),
      });
      const tabs = await cdpSession.listTabs();
      expect(tabs.length).toBe(1);
      expect(cdpSession.mode).toBe('cdp_attached_existing');
      await cdpSession.close();
      expect(cdpBrowserClosed).toBe(false);
      expect(cdpExistingContextClosed).toBe(false);

      // 3. BrowserSessionManager isolates Conversation A vs Conversation B
      const mgr = new BrowserSessionManager({ persistentProfilesRoot: profileRoot });
      const sA = mgr.getOrCreate('conv-A');
      const sB = mgr.getOrCreate('conv-B');
      expect(sA).not.toBe(sB);
      expect(mgr.list('conv-A').length).toBe(1);
      expect(mgr.list('conv-B').length).toBe(1);
      await mgr.closeAll();
    } finally {
      rmSync(profileRoot, { recursive: true, force: true });
    }
  });

  it('isolates ComputerUseController snapshots per conversation, annotates SoM via real Python bridge, and forwards multimodal images', async () => {
    const bridge = new PythonAgentBridge();
    try {
      // Verify real Python runtime diagnostics over NDJSON stdio
      const diag = await bridge.diagnostics();
      expect(diag.runtime).toBe('python');
      expect(diag.capabilities.somPngAnnotation).toBe(true);
      expect(diag.capabilities.concurrentTurns).toBe(true);

      const png80x60 = makeTestPngBase64(80, 60);

      const nativeCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
      const mockHelper = {
        lastExternalForegroundWindow: async () => ({
          status: 'available' as const,
          window: {
            windowId: 'win_1',
            title: 'Test Notepad',
            processName: 'notepad.exe',
            pid: 4242,
            observedAt: Date.now(),
            rect: { x: 0, y: 0, width: 80, height: 60 },
            isMinimized: false,
          },
        }),
        call: async (cmd: string, args: Record<string, unknown>) => {
          nativeCalls.push({ cmd, args });
          if (cmd === 'capture_window') {
            return { width: 80, height: 60, format: 'image/png', base64: png80x60 };
          }
          if (cmd === 'find_elements') {
            return {
              elements: [
                { name: 'Save', role: 'Button', automationId: 'btnSave', rect: { x: 10, y: 20, width: 30, height: 20 }, enabled: true },
              ],
            };
          }
          if (cmd === 'mouse_action') {
            return { executed: true, x: Number(args.x), y: Number(args.y), action: String(args.action) };
          }
          if (cmd === 'send_keys') {
            return { executed: true, key: String(args.key) };
          }
          return { executed: true };
        },
      };

      let allowFg = false;
      const computerUse = new ComputerUseController({
        nativeHelper: mockHelper as never,
        getSettings: () => ({
          captureMode: 'som',
          interactionPolicy: 'background_first',
          requireVerification: true,
          allowForegroundFallback: allowFg,
        }),
        annotateSom: (req) => bridge.annotateSomPng(req),
      });
      const executors = new ToolExecutors({ computerUse });

      // Conversation A captures in SoM mode -> real Python SoM annotation + multimodal ToolResult.image!
      const capA = await executors.run('computer_use', { action: 'capture', mode: 'som' }, undefined, { taskId: 'tA', ownerId: 'conv-A' });
      expect(capA.ok).toBe(true);
      expect(capA.content).toContain('Set-of-Marks annotated');
      expect(capA.image?.mediaType).toBe('image/png');
      expect(capA.image?.dataBase64).toBeTruthy();
      expect(capA.image?.dataBase64).not.toBe(png80x60);

      // Conversation B has NO snapshot (isolated from Conversation A!)
      const clickB = await executors.run('computer_use', { action: 'click', element: 1 }, undefined, { taskId: 'tB', ownerId: 'conv-B' });
      expect(clickB.ok).toBe(false);
      expect(clickB.content).toContain('No active capture snapshot');

      // Foreground action refused when allowForegroundFallback is false
      const dblRefused = await executors.run('computer_use', { action: 'double_click', element: 1 }, undefined, { taskId: 'tA', ownerId: 'conv-A' });
      expect(dblRefused.ok).toBe(false);
      expect(dblRefused.content).toContain('foreground_required');

      // Foreground action executes real mouse_action when allowForegroundFallback is true
      allowFg = true;
      const dblOk = await executors.run('computer_use', { action: 'double_click', element: 1 }, undefined, { taskId: 'tA', ownerId: 'conv-A' });
      expect(dblOk.ok).toBe(true);
      expect(dblOk.content).toContain('foreground_approved');
      expect(nativeCalls.some((c) => c.cmd === 'mouse_action' && c.args.action === 'double_click')).toBe(true);
    } finally {
      await bridge.dispose();
    }
  });

  it('includes all multilingual Whisper models in catalog and routes VoiceService through local-only privacy & Python bridge', async () => {
    const ids = VOICE_MODEL_CATALOG.map((m) => m.id);
    for (const expectedId of ['tiny.en', 'base.en', 'small.en', 'tiny', 'base', 'small', 'large-v3-turbo', 'kokoro-v1.0-int8']) {
      expect(ids).toContain(expectedId);
    }

    const voiceBlocked = new VoiceService(undefined, undefined, {
      getSettings: () => ({ ...DEFAULT_SETTINGS.voice, sttProvider: 'openai', ttsProvider: 'elevenlabs' }),
      isLocalOnly: () => true,
      getProviderApiKey: () => 'sk-test',
    });
    const sttRes = await voiceBlocked.transcribeWav(makeMinimalWav());
    expect(sttRes.ok).toBe(false);
    expect(sttRes.error).toContain('local-only');

    const ttsRes = await voiceBlocked.speak('Hello world');
    expect(ttsRes.ok).toBe(false);
    expect(ttsRes.error).toContain('local-only');

    const pySpy = vi.fn(async () => ({ ok: true, provider: 'openai', text: 'transcribed via python', model: 'whisper-1' }));
    const voicePy = new VoiceService(undefined, undefined, {
      getSettings: () => ({ ...DEFAULT_SETTINGS.voice, sttProvider: 'openai' }),
      isLocalOnly: () => false,
      getProviderApiKey: () => 'sk-test',
      pythonBridge: { voiceTranscribe: pySpy } as never,
    });
    const sttPy = await voicePy.transcribeWav(makeMinimalWav());
    expect(sttPy.ok).toBe(true);
    expect(sttPy.text).toBe('transcribed via python');
    expect(sttPy.backend).toBe('python/openai');
    expect(pySpy).toHaveBeenCalledTimes(1);
  });
});
