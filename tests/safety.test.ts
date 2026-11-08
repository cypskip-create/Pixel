import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/types';
import { ToolExecutors } from '../src/main/agent/executors';
import type { ToolResult } from '../src/main/agent/executors';
import { runWithDeadline } from '../src/main/agent/executor';
import { NetworkGuard } from '../src/main/agent/netGuard';
import { JsonlAuditSink, readAuditFile, redactAuditText, sanitiseAuditEntry } from '../src/main/agent/auditStore';
import { AuditLog } from '../src/main/agent/runtime';
import { deriveGrantScope, scopeCovers, originOf, describeScope } from '../src/main/agent/scope';
import { ToolRegistry, applyDecision } from '../src/main/agent/tools';

/* ------------------------------------------------------------------ *
 * Scoped approvals
 * ------------------------------------------------------------------ */

describe('deriveGrantScope', () => {
  it('limits browser_navigate to the requested origin', () => {
    expect(deriveGrantScope('browser_navigate', { url: 'https://a.example/path?q=1' })).toEqual({
      origin: 'https://a.example',
    });
  });

  it('treats different ports and schemes as different origins', () => {
    expect(originOf('http://a.example')).not.toBe(originOf('https://a.example'));
    expect(originOf('https://a.example:8443')).not.toBe(originOf('https://a.example'));
  });

  it('normalises application names', () => {
    expect(deriveGrantScope('open_application', { name: ' Notepad.EXE ' })).toEqual({ app: 'notepad' });
  });

  it('is empty for tools with nothing to scope by', () => {
    expect(deriveGrantScope('get_current_time', {})).toEqual({});
  });

  it('ignores non-http URLs rather than inventing a scope', () => {
    expect(deriveGrantScope('browser_navigate', { url: 'javascript:alert(1)' })).toEqual({});
  });
});

describe('scopeCovers', () => {
  it('covers anything when the grant has no target', () => {
    expect(scopeCovers(undefined, { origin: 'https://x.example' })).toBe(true);
  });
  it('rejects a different origin', () => {
    expect(scopeCovers({ origin: 'https://a.example' }, { origin: 'https://b.example' })).toBe(false);
  });
  it('accepts the same origin', () => {
    expect(scopeCovers({ origin: 'https://a.example' }, { origin: 'https://a.example' })).toBe(true);
  });
  it('describes a scope for the approval card', () => {
    expect(describeScope({ origin: 'https://a.example' })).toBe('only https://a.example');
  });
});

describe('scoped grants in the registry', () => {
  function granted(url: string): ToolRegistry {
    const registry = new ToolRegistry();
    const grant = applyDecision(
      { requestId: 'r', approved: true, duration: 'session' },
      { toolName: 'browser_navigate', args: { url } },
    );
    expect(grant).not.toBeNull();
    registry.grant(grant!);
    return registry;
  }

  it('allows the origin that was approved', () => {
    const registry = granted('https://a.example/start');
    expect(registry.evaluate('browser_navigate', 'agent', { url: 'https://a.example/other' }).allowed).toBe(true);
  });

  it('asks again for a different origin', () => {
    const registry = granted('https://a.example/start');
    const decision = registry.evaluate('browser_navigate', 'agent', { url: 'https://evil.example/' });
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ needsApproval: true });
  });

  it('records the target on the grant', () => {
    const grant = applyDecision(
      { requestId: 'r', approved: true, duration: 'session' },
      { toolName: 'open_application', args: { name: 'notepad' } },
    );
    expect(grant?.target).toEqual({ app: 'notepad' });
  });
});

/* ------------------------------------------------------------------ *
 * Cancellation
 * ------------------------------------------------------------------ */

describe('runWithDeadline', () => {
  it('returns the tool result when it finishes in time', async () => {
    const result = await runWithDeadline(async () => ({ ok: true, content: 'done' }), 1000, 'slow');
    expect(result).toEqual({ ok: true, content: 'done' });
  });

  it('aborts the signal on timeout instead of only abandoning the work', async () => {
    let sawAbort = false;
    const result = await runWithDeadline(
      (signal) =>
        new Promise<ToolResult>((resolve) => {
          signal.addEventListener('abort', () => {
            sawAbort = true;
            resolve({ ok: false, content: 'unwound', errorCode: 'CANCELLED' });
          });
        }),
      30,
      'took too long',
    );
    expect(sawAbort).toBe(true);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.content).toBe('took too long');
  });

  it('stops waiting for a tool that ignores the signal', async () => {
    const started = Date.now();
    const result = await runWithDeadline(
      () => new Promise<ToolResult>(() => undefined),
      20,
      'hung',
      undefined,
      40,
    );
    expect(result.errorCode).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('aborts when the parent run is cancelled', async () => {
    const parent = new AbortController();
    let sawAbort = false;
    const pending = runWithDeadline(
      (signal) =>
        new Promise<ToolResult>((resolve) => {
          signal.addEventListener('abort', () => {
            sawAbort = true;
            resolve({ ok: false, content: 'stopped', errorCode: 'CANCELLED' });
          });
        }),
      5000,
      'slow',
      parent.signal,
    );
    parent.abort();
    const result = await pending;
    expect(sawAbort).toBe(true);
    expect(result.errorCode).toBe('CANCELLED');
  });

  it('does not start when the parent is already cancelled', async () => {
    const parent = new AbortController();
    parent.abort();
    const result = await runWithDeadline(
      (signal) =>
        new Promise<ToolResult>((resolve) => {
          if (signal.aborted) resolve({ ok: false, content: 'never started', errorCode: 'CANCELLED' });
        }),
      5000,
      'slow',
      parent.signal,
    );
    expect(result.errorCode).toBe('CANCELLED');
  });
});

describe('ToolExecutors cancellation', () => {
  it('refuses to start a call whose signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new ToolExecutors().run('get_current_time', {}, controller.signal);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('CANCELLED');
  });

  it('reports a call aborted mid-flight as cancelled, not as success', async () => {
    const controller = new AbortController();
    const executors = new ToolExecutors();
    const pending = executors.run('get_current_time', {}, controller.signal);
    controller.abort();
    const result = await pending;
    expect(result.errorCode).toBe('CANCELLED');
  });

  it('runs normally when no signal is given', async () => {
    expect((await new ToolExecutors().run('get_current_time', {})).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Network guard: DNS rebinding, redirects, multiple records
 * ------------------------------------------------------------------ */

describe('NetworkGuard', () => {
  const table: Record<string, string[]> = {
    'good.example': ['93.184.216.34'],
    'internal.example': ['10.0.0.8'],
    'metadata.example': ['169.254.169.254'],
    'mixed.example': ['93.184.216.34', '192.168.1.5'],
    'v6.example': ['2606:4700::1111'],
    'v6local.example': ['fd00::1'],
  };
  const resolve = async (host: string): Promise<string[]> => {
    const found = table[host];
    if (!found) throw new Error('ENOTFOUND');
    return found;
  };
  const guard = new NetworkGuard({ resolve });

  it('allows a name that resolves to a public address', async () => {
    expect(await guard.check('https://good.example/page')).toBeNull();
    expect(await guard.check('https://v6.example/')).toBeNull();
  });

  it('blocks a public-looking name that resolves to a private address', async () => {
    expect(await guard.check('https://internal.example/')).toMatch(/private-network address/);
    expect(await guard.check('https://v6local.example/')).toMatch(/private-network address/);
  });

  it('blocks the cloud metadata endpoint however it is named', async () => {
    expect(await guard.check('http://169.254.169.254/latest/meta-data/')).toMatch(/private/);
    expect(await guard.check('http://metadata.example/')).toMatch(/private-network address/);
  });

  it('blocks a name when any one of its records is private', async () => {
    expect(await guard.check('https://mixed.example/')).toMatch(/192\.168\.1\.5/);
  });

  it('fails closed when the name cannot be resolved', async () => {
    expect(await guard.check('https://nowhere.example/')).toMatch(/could not resolve/);
  });

  it('treats a redirect hop as a fresh request', async () => {
    // The browser issues the redirect target as its own request; the guard
    // judges it independently of the page that redirected.
    expect(await guard.check('https://good.example/redirect')).toBeNull();
    expect(await guard.check('http://127.0.0.1:8080/admin')).toMatch(/private/);
  });

  it('catches a rebind where the second lookup differs from the first', async () => {
    let calls = 0;
    const rebinding = new NetworkGuard({
      resolve: async () => (calls++ === 0 ? ['93.184.216.34'] : ['10.0.0.8']),
    });
    expect(await rebinding.check('https://attacker.example/')).toBeNull();
    // Chromium looks the name up itself; the answer it saw is verified after the fact.
    expect(rebinding.checkConnectedAddress('10.0.0.8')).toMatch(/private-network address/);
    // And a later request for the same name is judged on the new answer.
    expect(await rebinding.check('https://attacker.example/img.png')).toMatch(/10\.0\.0\.8/);
  });

  it('accepts a public connected address', () => {
    expect(guard.checkConnectedAddress('93.184.216.34')).toBeNull();
    expect(guard.checkConnectedAddress(undefined)).toBeNull();
  });

  it('lets data: and blob: through but refuses other schemes', async () => {
    expect(await guard.check('data:text/plain,hi')).toBeNull();
    expect(await guard.check('ftp://good.example/')).toMatch(/not allowed/);
    expect(await guard.check('file:///C:/Windows/win.ini')).toMatch(/not allowed/);
  });

  it('allows private targets only when explicitly relaxed', async () => {
    const relaxed = new NetworkGuard({ allowPrivateNetwork: true, resolve });
    expect(await relaxed.check('http://127.0.0.1:3000/')).toBeNull();
    expect(relaxed.checkConnectedAddress('10.0.0.8')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Persistent audit
 * ------------------------------------------------------------------ */

describe('audit persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pixel-audit-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
    id: 'a1',
    at: 1_700_000_000_000,
    kind: 'tool',
    summary: 'Ran: open_application',
    outcome: 'ok',
    ...over,
  });

  it('redacts API keys, bearer tokens and password fields', () => {
    expect(redactAuditText('key sk-abcdefghijklmnopqrstuvwx used')).not.toMatch(/abcdefghijklmnop/);
    expect(redactAuditText('Authorization: Bearer abc.def.ghi-1234567890')).not.toMatch(/ghi-1234567890/);
    expect(redactAuditText('password=hunter2 next')).toBe('password=[redacted] next');
    expect(redactAuditText('{"apiKey": "supersecretvalue"}')).not.toMatch(/supersecretvalue/);
  });

  it('never stores what was typed', () => {
    const safe = sanitiseAuditEntry(entry({ summary: 'Ran: type_text', detail: 'my bank pin is 4921' }));
    expect(safe.detail).toBeUndefined();
    const browser = sanitiseAuditEntry(entry({ summary: 'Ran: browser_type', detail: 'hunter2' }));
    expect(browser.detail).toBeUndefined();
  });

  it('keeps useful detail for other tools, bounded in length', () => {
    const safe = sanitiseAuditEntry(entry({ detail: 'x'.repeat(2000) }));
    expect(safe.detail!.length).toBeLessThanOrEqual(300);
  });

  it('writes entries to disk and reads them back newest first', () => {
    const file = join(dir, 'audit', 'audit.jsonl');
    const log = new AuditLog(new JsonlAuditSink(file));
    log.record('tool', 'Ran: get_current_time', 'ok');
    log.record('permission', 'Denied "type_text"', 'denied');

    const stored = readAuditFile(file);
    expect(stored.map((e) => e.outcome)).toEqual(['denied', 'ok']);
    expect(stored[0]?.kind).toBe('permission');
  });

  it('survives a restart: a new log sees earlier entries on disk', () => {
    const file = join(dir, 'audit.jsonl');
    new AuditLog(new JsonlAuditSink(file)).record('system', 'first run', 'ok');
    new AuditLog(new JsonlAuditSink(file)).record('system', 'second run', 'ok');
    expect(readAuditFile(file).map((e) => e.summary)).toEqual(['second run', 'first run']);
  });

  it('skips a torn line left by a crash', () => {
    const file = join(dir, 'audit.jsonl');
    new JsonlAuditSink(file).write(entry());
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"id":"broken","at":`, 'utf8');
    expect(readAuditFile(file)).toHaveLength(1);
  });

  it('rotates instead of growing without bound', () => {
    const file = join(dir, 'audit.jsonl');
    const sink = new JsonlAuditSink(file, { maxBytes: 400, keepFiles: 2 });
    for (let i = 0; i < 20; i += 1) sink.write(entry({ id: `e${i}`, summary: `entry number ${i} padding padding` }));
    expect(readFileSync(`${file}.1`, 'utf8').length).toBeGreaterThan(0);
    expect(readFileSync(file, 'utf8').length).toBeLessThan(2000);
  });

  it('never throws when the path is unusable', () => {
    const sink = new JsonlAuditSink(join(dir, 'file.txt', 'nested', 'audit.jsonl'));
    writeFileSync(join(dir, 'file.txt'), 'x');
    expect(() => sink.write(entry())).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * Native helper client (fake process; the real PixelNative.exe is Windows-only)
 * ------------------------------------------------------------------ */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { NativeHelper, NativeHelperError, toDipRect } from '../src/main/services/nativeHelper';

function fakeProcess(onRequest: (req: { id: number; cmd: string; args: unknown }, reply: (obj: unknown) => void) => void) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const emitter = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  Object.assign(emitter, { stdin, stdout, stderr: new PassThrough(), exitCode: null, kill: () => {
    (emitter as unknown as { exitCode: number | null }).exitCode = 0;
    emitter.emit('exit', 0);
    return true;
  } });
  let buffer = '';
  stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      onRequest(JSON.parse(line), (obj) => stdout.write(`${JSON.stringify(obj)}\n`));
    }
  });
  return emitter;
}

describe('NativeHelper', () => {
  const base = { executablePath: 'C:\\x\\PixelNative.exe', platform: 'win32' as const };

  it('is unavailable off Windows and says why', async () => {
    const helper = new NativeHelper({ ...base, platform: 'linux' });
    await expect(helper.call('ping', {})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(helper.running).toBe(false);
  });

  it('is unavailable until the helper has been built', async () => {
    const helper = new NativeHelper({ ...base, exists: () => false });
    const status = helper.available();
    expect(status.available).toBe(false);
    await expect(helper.call('ping', {})).rejects.toBeInstanceOf(NativeHelperError);
  });

  it('starts lazily, answers a request, and matches replies by id', async () => {
    let started = 0;
    const helper = new NativeHelper({
      ...base,
      spawnFn: () => {
        started += 1;
        return fakeProcess((req, reply) => reply({ id: req.id, ok: true, result: { version: '1.0' } }));
      },
    });
    expect(helper.running).toBe(false);
    expect(await helper.call('ping', {})).toEqual({ version: '1.0' });
    expect(await helper.call('ping', {})).toEqual({ version: '1.0' });
    expect(started).toBe(1);
    helper.dispose();
  });

  it('surfaces a helper error as FAILED', async () => {
    const helper = new NativeHelper({
      ...base,
      spawnFn: () => fakeProcess((req, reply) => reply({ id: req.id, ok: false, error: 'no window' })),
    });
    await expect(helper.call('foreground_window', {})).rejects.toMatchObject({ code: 'FAILED', message: 'no window' });
    helper.dispose();
  });

  it('times out a helper that never answers', async () => {
    const helper = new NativeHelper({ ...base, requestTimeoutMs: 30, spawnFn: () => fakeProcess(() => undefined) });
    await expect(helper.call('ping', {})).rejects.toMatchObject({ code: 'TIMEOUT' });
    helper.dispose();
  });

  it('cancels a pending request when the signal aborts', async () => {
    const helper = new NativeHelper({ ...base, spawnFn: () => fakeProcess(() => undefined) });
    const controller = new AbortController();
    const pending = helper.call('ping', {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    helper.dispose();
  });

  it('fails waiting requests if the helper crashes', async () => {
    let proc!: ChildProcessWithoutNullStreams;
    const helper = new NativeHelper({
      ...base,
      spawnFn: () => (proc = fakeProcess(() => undefined)),
    });
    const pending = helper.call('ping', {});
    proc.emit('exit', 1);
    await expect(pending).rejects.toMatchObject({ code: 'CRASHED' });
  });

  it('restarts after a crash on the next call', async () => {
    let starts = 0;
    let proc!: ChildProcessWithoutNullStreams;
    const helper = new NativeHelper({
      ...base,
      spawnFn: () => {
        starts += 1;
        return (proc = fakeProcess((req, reply) => reply({ id: req.id, ok: true, result: { version: String(starts) } })));
      },
    });
    await helper.call('ping', {});
    (proc as unknown as { exitCode: number | null }).exitCode = 1;
    proc.emit('exit', 1);
    expect(await helper.call('ping', {})).toEqual({ version: '2' });
    helper.dispose();
  });

  it('ignores stray non-JSON output from the helper', async () => {
    const helper = new NativeHelper({
      ...base,
      spawnFn: () =>
        fakeProcess((req, reply) => {
          (reply as (o: unknown) => void)({ noise: true });
          reply({ id: req.id, ok: true, result: { version: 'ok' } });
        }),
    });
    expect(await helper.call('ping', {})).toEqual({ version: 'ok' });
    helper.dispose();
  });

  it('stops itself when idle so nothing runs in the background', async () => {
    const helper = new NativeHelper({
      ...base,
      idleStopMs: 20,
      spawnFn: () => fakeProcess((req, reply) => reply({ id: req.id, ok: true, result: { version: '1' } })),
    });
    await helper.call('ping', {});
    expect(helper.running).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(helper.running).toBe(false);
  });

  it('converts a physical-pixel rectangle to DIP through the supplied converter', () => {
    const at150 = (p: { x: number; y: number }) => ({ x: p.x / 1.5, y: p.y / 1.5 });
    expect(toDipRect({ x: 300, y: 150, width: 150, height: 75 }, at150)).toEqual({ x: 200, y: 100, width: 100, height: 50 });
  });
});