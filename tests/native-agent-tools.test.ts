import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { ToolExecutors } from '../src/main/agent/executors';
import { NativeHelperError } from '../src/main/services/nativeHelper';
import { NativeHelper } from '../src/main/services/nativeHelper';
import type { NativeHelper as NativeHelperType } from '../src/main/services/nativeHelper';
import { DesktopInputLease } from '../src/main/agent/inputLease';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import { buildPermissionRequest } from '../src/main/agent/executor';

const windowInfo = {
  windowId: 'window-test-opaque-ref',
  title: 'Settings',
  processName: 'SystemSettings',
  pid: 1234,
  observedAt: 1_760_000_000_000,
  rect: { x: -1920, y: 0, width: 1920, height: 1080 },
  isMinimized: false,
};
const element = {
  name: 'Network & internet',
  role: 'Button',
  automationId: 'NetworkCategory',
  rect: { x: 24, y: 42, width: 210, height: 48 },
  enabled: true,
};

describe('Windows UI Automation tools', () => {
  it('keeps native observation behind the screen approval gate and excludes it in Guide Mode when it would act', () => {
    const registry = new ToolRegistry(BUILTIN_TOOLS);
    const inspect = registry.get('find_ui_elements');
    const lastExternal = registry.get('get_last_external_foreground_window');
    const listExternal = registry.get('list_external_windows');
    const invoke = registry.get('invoke_ui_element');
    expect(inspect?.requiresApproval).toBe(true);
    expect(inspect?.changesState).toBe(false);
    expect(lastExternal).toMatchObject({ requiresApproval: true, changesState: false, risk: 'high' });
    expect(listExternal).toMatchObject({ requiresApproval: true, changesState: false, risk: 'high' });
    expect(registry.availableFor('guide')).toContainEqual(lastExternal);
    expect(invoke?.requiresApproval).toBe(true);
    expect(invoke?.changesState).toBe(true);
    expect(registry.evaluate('invoke_ui_element', 'guide').allowed).toBe(false);
    expect(registry.evaluate('invoke_ui_element', 'hybrid').allowed).toBe(false);
    const permission = buildPermissionRequest(invoke!, {
      selector: 'NetworkCategory',
      role: 'Button',
      targetWindowId: windowInfo.windowId,
      expectedWindowTitle: 'Settings — Network',
      expectedProcessId: 1234,
      expectedProcessName: 'SystemSettings',
    });
    expect(permission.target).toBe('SystemSettings (PID 1234), window titled "Settings — Network"; ref window-test-opaque-ref');
    expect(permission.args.expectedWindowTitle).toBe('Settings — Network');
  });

  it('returns the last external window and never requests a screenshot', async () => {
    const lastExternalForegroundWindow = vi.fn(async () => ({ status: 'available' as const, window: windowInfo }));
    const captureDisplay = vi.fn();
    const executors = new ToolExecutors({
      nativeHelper: { lastExternalForegroundWindow } as unknown as NativeHelperType,
      captureDisplay,
      toDipRect: (rect) => ({ x: rect.x / 2, y: rect.y / 2, width: rect.width / 2, height: rect.height / 2 }),
    });

    const result = await executors.run('get_last_external_foreground_window', {});

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Settings (SystemSettings, PID 1234)');
    expect(result.content).toContain(windowInfo.windowId);
    expect(result.detail?.status).toBe('available');
    expect(lastExternalForegroundWindow).toHaveBeenCalledTimes(1);
    expect(captureDisplay).not.toHaveBeenCalled();
  });

  it('reports unavailable when no trustworthy external window has been observed', async () => {
    const lastExternalForegroundWindow = vi.fn(async () => ({
      status: 'unavailable' as const,
      reason: 'No trustworthy external window has been observed.',
    }));
    const executors = new ToolExecutors({
      nativeHelper: { lastExternalForegroundWindow } as unknown as NativeHelperType,
    });

    const result = await executors.run('get_last_external_foreground_window', {});

    expect(result).toMatchObject({ ok: true, detail: { status: 'unavailable' } });
    expect(result.content).toContain('No trustworthy external window has been observed.');
  });

  it('reports unavailable when the native bridge is absent', async () => {
    const result = await new ToolExecutors({}).run('get_last_external_foreground_window', {});
    expect(result).toMatchObject({ ok: false, errorCode: 'UNAVAILABLE' });
  });

  it('reports a closed external target as stale and withholds its target ref', async () => {
    const lastExternalForegroundWindow = vi.fn(async () => ({
      status: 'stale' as const,
      window: windowInfo,
      reason: 'The window has closed.',
    }));
    const executors = new ToolExecutors({
      nativeHelper: { lastExternalForegroundWindow } as unknown as NativeHelperType,
    });

    const result = await executors.run('get_last_external_foreground_window', {});

    expect(result.ok).toBe(true);
    expect(result.content).toContain('is stale');
    expect(result.content).toContain('The window has closed.');
    expect((result.detail?.window as Record<string, unknown>)?.windowId).toBeUndefined();
  });

  it('lists external windows with opaque references so the user can choose an ambiguous target', async () => {
    const listExternalWindows = vi.fn(async () => ({ windows: [windowInfo], truncated: false }));
    const executors = new ToolExecutors({
      nativeHelper: { listExternalWindows } as unknown as NativeHelperType,
    });

    const result = await executors.run('list_external_windows', {});

    expect(result.content).toContain('Ask the user to choose');
    expect(result.content).toContain(`ref=${windowInfo.windowId}`);
    expect((result.detail?.windows as Array<Record<string, unknown>>)[0]).toMatchObject({
      processName: 'SystemSettings', pid: 1234, windowId: windowInfo.windowId,
    });
  });

  it('searches semantic UI elements and converts bounds while preserving physical bounds', async () => {
    const call = vi.fn().mockResolvedValue({ window: windowInfo, elements: [element], truncated: false });
    const executors = new ToolExecutors({
      nativeHelper: { call } as unknown as NativeHelperType,
      toDipRect: (rect) => ({ x: rect.x / 2, y: rect.y / 2, width: rect.width / 2, height: rect.height / 2 }),
    });

    const result = await executors.run('find_ui_elements', { text: 'Network', roles: ['Button'], maxResults: 3 });
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledWith('find_elements', { text: 'Network', roles: ['Button'], maxResults: 3 }, undefined);
    expect(result.detail?.coordinateSpace).toBe('electron_dip');
    const found = (result.detail?.elements as Array<Record<string, unknown>>)[0];
    expect(found?.rect).toEqual({ x: 12, y: 21, width: 105, height: 24 });
    expect(found?.physicalRect).toEqual(element.rect);
    expect(result.content).toContain('Button "Network & internet"');
  });

  it('invokes one approved exact semantic target and requires a matching UIA postcondition', async () => {
    const call = vi.fn().mockResolvedValue({ window: windowInfo, element, invoked: true as const });
    const executors = new ToolExecutors({ nativeHelper: { call } as unknown as NativeHelperType });
    const result = await executors.run('invoke_ui_element', {
      selector: 'NetworkCategory',
      targetWindowId: windowInfo.windowId,
      role: 'Button',
      expectedWindowTitle: 'Settings',
      expectedProcessId: windowInfo.pid,
      expectedProcessName: windowInfo.processName,
      expectedResult: { selector: 'Wi-Fi', state: 'present', role: 'TabItem' },
    });
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledWith('invoke_element', {
      selector: 'NetworkCategory',
      targetWindowId: windowInfo.windowId,
      expectedWindowTitle: 'Settings',
      expectedProcessId: windowInfo.pid,
      expectedProcessName: windowInfo.processName,
      role: 'Button',
      expectedResult: { selector: 'Wi-Fi', state: 'present', role: 'TabItem' },
    }, undefined);
    expect(result.content).toMatch(/verify that the control is present/);
    expect(result.verification).toBeUndefined();
  });

  it('can search a selected background window without activating it', async () => {
    const call = vi.fn().mockResolvedValue({ window: windowInfo, elements: [element], truncated: false });
    const executors = new ToolExecutors({ nativeHelper: { call } as unknown as NativeHelperType });
    const selection = {
      targetWindowId: windowInfo.windowId,
      expectedWindowTitle: windowInfo.title,
      expectedProcessId: windowInfo.pid,
      expectedProcessName: windowInfo.processName,
    };

    const result = await executors.run('find_ui_elements', { text: 'Network', ...selection });

    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledWith('find_elements', { text: 'Network', ...selection }, undefined);
    expect(result.content).toContain(`ref ${windowInfo.windowId}`);
  });

  it('fails closed when only part of a target window identity is supplied', async () => {
    const call = vi.fn();
    const executors = new ToolExecutors({ nativeHelper: { call } as unknown as NativeHelperType });

    const result = await executors.run('find_ui_elements', {
      text: 'Network',
      targetWindowId: windowInfo.windowId,
      expectedWindowTitle: windowInfo.title,
    });

    expect(result).toMatchObject({ ok: false, errorCode: 'FAILED' });
    expect(result.content).toContain('identity is incomplete');
    expect(call).not.toHaveBeenCalled();
  });

  it('reports helper cancellation and timeout distinctly', async () => {
    const cancelled = new ToolExecutors({
      nativeHelper: { call: vi.fn().mockRejectedValue(new NativeHelperError('The request was cancelled.', 'CANCELLED')) } as unknown as NativeHelperType,
    });
    expect((await cancelled.run('get_foreground_window', {})).errorCode).toBe('CANCELLED');
    const timedOut = new ToolExecutors({
      nativeHelper: { call: vi.fn().mockRejectedValue(new NativeHelperError('The request took too long.', 'TIMEOUT')) } as unknown as NativeHelperType,
    });
    expect((await timedOut.run('get_foreground_window', {})).errorCode).toBe('TIMEOUT');
  });

  it('keeps the desktop-input lease held until an unconfirmed timed-out helper exits', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & {
      exitCode: number | null;
      killCount: number;
    };
    Object.assign(child, {
      stdin,
      stdout,
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      killCount: 0,
      kill: () => {
        child.killCount += 1;
        return true;
      },
    });
    stdin.on('data', () => undefined);
    const nativeHelper = new NativeHelper({
      executablePath: 'C:\\x\\PixelNative.exe',
      platform: 'win32',
      requestTimeoutMs: 20,
      terminationGraceMs: 10,
      spawnFn: () => child,
    });
    const inputLease = new DesktopInputLease();
    const executors = new ToolExecutors({ nativeHelper, inputLease });
    const run = executors.run('invoke_ui_element', {
      selector: 'File',
      targetWindowId: windowInfo.windowId,
      expectedWindowTitle: 'Calculator',
      expectedProcessId: windowInfo.pid,
      expectedProcessName: windowInfo.processName,
      expectedResult: { selector: 'Save', state: 'present', role: 'MenuItem' },
    });

    await vi.waitFor(() => expect(child.killCount).toBeGreaterThanOrEqual(2), { timeout: 500 });
    expect(inputLease.isHeld).toBe(true);

    child.exitCode = 1;
    child.emit('exit', 1);
    const result = await run;
    expect(result).toMatchObject({ ok: false, errorCode: 'TIMEOUT' });
    expect(inputLease.isHeld).toBe(false);
  });

  it('does not release the desktop-input lease when process errors do not prove exit', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & {
      exitCode: number | null;
      killCount: number;
    };
    Object.assign(child, {
      stdin,
      stdout,
      stderr: new PassThrough(),
      pid: 0,
      exitCode: null,
      signalCode: null,
      killCount: 0,
      kill: () => {
        child.killCount += 1;
        child.emit('error', new Error('simulated kill error'));
        return false;
      },
    });
    stdin.on('data', () => undefined);
    const nativeHelper = new NativeHelper({
      executablePath: 'C:\\x\\PixelNative.exe',
      platform: 'win32',
      requestTimeoutMs: 20,
      terminationGraceMs: 10,
      spawnFn: () => child,
    });
    const inputLease = new DesktopInputLease();
    const executors = new ToolExecutors({ nativeHelper, inputLease });
    let settled = false;
    const run = executors.run('invoke_ui_element', {
      selector: 'Run harmless UIA action',
      targetWindowId: windowInfo.windowId,
      expectedWindowTitle: 'Pixel UIA Harmless Fixture',
      expectedProcessId: windowInfo.pid,
      expectedProcessName: windowInfo.processName,
      expectedResult: { selector: 'Pixel harmless action: completed', state: 'present', role: 'Text' },
    }).finally(() => { settled = true; });

    await vi.waitFor(() => expect(child.killCount).toBeGreaterThanOrEqual(2), { timeout: 500 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(nativeHelper.terminating).toBe(true);
    expect(inputLease.isHeld).toBe(true);
    expect(settled).toBe(false);

    child.exitCode = 1;
    child.emit('exit', 1);
    const result = await run;
    expect(result).toMatchObject({ ok: false, errorCode: 'TIMEOUT' });
    expect(inputLease.isHeld).toBe(false);
  });

  it('validates the bounded UIA argument contracts', () => {
    const registry = new ToolRegistry(BUILTIN_TOOLS);
    expect(registry.validateArgs('find_ui_elements', { text: 'Open', maxResults: 25 })).toEqual({ ok: true });
    expect(registry.validateArgs('find_ui_elements', { text: 'Open', maxResults: 200 }).ok).toBe(false);
    expect(registry.validateArgs('invoke_ui_element', {
      selector: 'Open',
      targetWindowId: windowInfo.windowId,
      expectedWindowTitle: 'Settings',
      expectedProcessId: 1234,
      expectedProcessName: 'SystemSettings',
      expectedResult: { selector: 'Options', state: 'present' },
    })).toEqual({ ok: true });
    expect(registry.validateArgs('invoke_ui_element', { selector: 'Open' }).ok).toBe(false);
    expect(registry.validateArgs('invoke_ui_element', { selector: 'Open', arbitrary: true }).ok).toBe(false);
  });
});
