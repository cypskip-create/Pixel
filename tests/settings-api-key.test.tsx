// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionTestResult, CypsBridge } from '../src/shared/types';
import { mergeSettings } from '../src/shared/types';
import { SettingsPanel } from '../src/renderer/components/SettingsPanel';
import { BridgeContext } from '../src/renderer/hooks/useBridge';
import { useSettings } from '../src/renderer/hooks/useSettings';
import type { BridgeStatus } from '../src/renderer/lib/bridge';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

afterEach(() => {
  if (mountedRoot !== null) act(() => mountedRoot?.unmount());
  mountedRoot = null;
  mountedContainer?.remove();
  mountedContainer = null;
  vi.restoreAllMocks();
});

function makeBridge(overrides: Record<string, unknown> = {}) {
  const settings = {
    get: vi.fn(async () => mergeSettings(null)),
    set: vi.fn(async () => mergeSettings(null)),
    setApiKey: vi.fn(async () => ({ ok: true })),
    hasApiKey: vi.fn(async () => false),
    clearApiKey: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => ({ ok: true, model: 'deepseek-flash' })),
    ...overrides,
  };
  return { bridge: { settings } as unknown as CypsBridge, settings };
}

function Harness() {
  const state = useSettings();
  return createElement(SettingsPanel, {
    settings: state.settings,
    displays: [],
    onPatch: state.patch,
    onRequestMode: state.setMode,
    onClose: () => undefined,
    hasApiKey: state.hasApiKey,
    onSaveApiKey: state.saveApiKey,
    onRemoveApiKey: state.removeApiKey,
    onTestConnection: state.testApiKeyConnection,
    error: state.error,
    saving: state.saving,
  });
}

async function render(bridgeStatus: BridgeStatus) {
  mountedContainer = document.createElement('div');
  document.body.append(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  await act(async () => {
    mountedRoot?.render(
      createElement(BridgeContext.Provider, { value: bridgeStatus }, createElement(Harness)),
    );
  });
  return mountedContainer;
}

function ready(bridge: CypsBridge): BridgeStatus {
  return { kind: 'ready', bridge };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

async function click(container: HTMLElement, label: string) {
  const target = button(container, label);
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function enterKey(container: HTMLElement, key: string) {
  const input = container.querySelector<HTMLInputElement>('#deepseek-api-key');
  if (!input) throw new Error('Missing API key input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, key);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

describe('DeepSeek API key settings', () => {
  it('enters a new key, masks it, saves it securely, and never puts it in settings or logs', async () => {
    const secret = 'sk-test-not-a-real-secret';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { bridge, settings } = makeBridge();
    const container = await render(ready(bridge));

    await click(container, 'Add Key');
    const input = await enterKey(container, secret);
    expect(input.type).toBe('password');
    expect(input.value).toBe(secret);
    expect(container.textContent).not.toContain(secret);

    await click(container, 'Show API key');
    expect(container.querySelector<HTMLInputElement>('#deepseek-api-key')?.type).toBe('text');
    await click(container, 'Hide API key');
    expect(container.querySelector<HTMLInputElement>('#deepseek-api-key')?.type).toBe('password');

    await click(container, 'Save Key');
    expect(settings.setApiKey).toHaveBeenCalledWith(secret);
    expect(settings.set).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Configured');
    expect(container.querySelector('#deepseek-api-key')).toBeNull();
    expect(container.textContent).not.toContain(secret);
    expect(localStorage.length).toBe(0);
    for (const spy of [log, warn, error]) {
      expect(spy.mock.calls.flat().join(' ')).not.toContain(secret);
    }
  });

  it('loads the existing configured status through hasApiKey without retrieving the key', async () => {
    const { bridge, settings } = makeBridge({ hasApiKey: vi.fn(async () => true) });
    const container = await render(ready(bridge));

    expect(settings.hasApiKey).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Configured');
    expect(container.querySelector('#deepseek-api-key')).toBeNull();
    expect(settings.get).toHaveBeenCalledTimes(1);
  });

  it('replaces an existing key without pre-filling the stored value', async () => {
    const oldKey = 'sk-stored-value-must-not-be-returned';
    const replacement = 'sk-replacement-not-real';
    const { bridge, settings } = makeBridge({ hasApiKey: vi.fn(async () => true) });
    const container = await render(ready(bridge));

    await click(container, 'Change Key');
    const input = container.querySelector<HTMLInputElement>('#deepseek-api-key');
    expect(input?.value).toBe('');
    expect(container.textContent).not.toContain(oldKey);
    await enterKey(container, replacement);
    await click(container, 'Save Key');

    expect(settings.setApiKey).toHaveBeenCalledWith(replacement);
    expect(container.textContent).toContain('Configured');
    expect(container.textContent).not.toContain(replacement);
  });

  it('requires confirmation before removing a configured key', async () => {
    const { bridge, settings } = makeBridge({ hasApiKey: vi.fn(async () => true) });
    const container = await render(ready(bridge));

    await click(container, 'Remove Key');
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(settings.clearApiKey).not.toHaveBeenCalled();
    await click(container, 'Confirm Remove');

    expect(settings.clearApiKey).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Not configured');
    expect(container.textContent).toContain('API key removed.');
  });

  it('cancels removal without clearing the key', async () => {
    const { bridge, settings } = makeBridge({ hasApiKey: vi.fn(async () => true) });
    const container = await render(ready(bridge));

    await click(container, 'Remove Key');
    await click(container, 'Cancel');

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(settings.clearApiKey).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Configured');
  });

  it('keeps the configured status and reports an IPC removal failure', async () => {
    const { bridge, settings } = makeBridge({
      hasApiKey: vi.fn(async () => true),
      clearApiKey: vi.fn(async () => { throw new Error('disk failure'); }),
    });
    const container = await render(ready(bridge));

    await click(container, 'Remove Key');
    await click(container, 'Confirm Remove');

    expect(settings.clearApiKey).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Configured');
    expect(container.textContent).toContain('Pixel could not remove the saved API key.');
  });

  it('clears the draft and reports a failed secure save', async () => {
    const { bridge, settings } = makeBridge({
      setApiKey: vi.fn(async () => ({ ok: false, error: 'Pixel could not save the API key securely.' })),
    });
    const container = await render(ready(bridge));
    await click(container, 'Add Key');
    await enterKey(container, 'sk-failed-save-test');
    await click(container, 'Save Key');

    expect(container.textContent).toContain('Pixel could not save the API key securely.');
    expect(container.querySelector<HTMLInputElement>('#deepseek-api-key')?.value).toBe('');
    expect(container.textContent).toContain('Not configured');
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('shows the backend error category when a connection test fails', async () => {
    const { bridge, settings } = makeBridge({
      hasApiKey: vi.fn(async () => true),
      testConnection: vi.fn(async () => ({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'The DeepSeek API key was rejected.', retryable: false },
      })),
    });
    const container = await render(ready(bridge));

    await click(container, 'Test Connection');

    expect(settings.testConnection).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Invalid key.');
    expect(container.textContent).not.toContain('Connected successfully.');
  });

  it('reports success only after the backend confirms a connection', async () => {
    const { bridge, settings } = makeBridge({ hasApiKey: vi.fn(async () => true) });
    const container = await render(ready(bridge));

    expect(container.textContent).not.toContain('Connected successfully.');
    expect(settings.testConnection).not.toHaveBeenCalled();
    await click(container, 'Test Connection');

    expect(settings.testConnection).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Connected successfully.');
  });

  it('turns a failed connection IPC call into safe provider feedback', async () => {
    const { bridge } = makeBridge({
      hasApiKey: vi.fn(async () => true),
      testConnection: vi.fn(async () => { throw new Error('sk-private-test-value'); }),
    });
    const container = await render(ready(bridge));

    await click(container, 'Test Connection');

    expect(container.textContent).toContain('Provider unavailable.');
    expect(container.textContent).not.toContain('sk-private-test-value');
  });

  it('maps the backend balance, rate-limit, network, and provider error categories', async () => {
    let outcome: ConnectionTestResult = {
      ok: false,
      error: { code: 'UNKNOWN', message: 'Unavailable.', retryable: false },
    };
    const testConnection = vi.fn(async (): Promise<ConnectionTestResult> => outcome);
    const { bridge } = makeBridge({ hasApiKey: vi.fn(async () => true), testConnection });
    const container = await render(ready(bridge));
    expect(testConnection).not.toHaveBeenCalled();

    const cases = [
      ['INSUFFICIENT_BALANCE', 'Insufficient balance.'],
      ['RATE_LIMITED', 'Rate limited.'],
      ['NETWORK', 'Network error.'],
      ['SERVER', 'Provider unavailable.'],
    ] as const;
    for (const [code, message] of cases) {
      outcome = { ok: false, error: { code, message: 'Backend test message.', retryable: false } };
      await click(container, 'Test Connection');
      expect(container.textContent).toContain(message);
      expect(container.textContent).not.toContain('Connected successfully.');
    }
    expect(testConnection).toHaveBeenCalledTimes(cases.length);
  });

  it('handles an unavailable native bridge without throwing or storing a draft', async () => {
    const container = await render({ kind: 'missing', reason: 'Native bridge unavailable.' });

    expect(container.textContent).toContain('Native bridge unavailable.');
    expect(container.textContent).toContain('Unknown');
    expect(container.querySelector('#deepseek-api-key')).toBeNull();
    await click(container, 'Add Key');
    await enterKey(container, 'sk-bridge-unavailable');
    await click(container, 'Save Key');
    expect(container.textContent).toContain('Secure key storage is unavailable.');
    expect(container.textContent).not.toContain('sk-bridge-unavailable');
  });

  it('handles a missing secure storage method and a failing hasApiKey status query', async () => {
    const { bridge } = makeBridge({ setApiKey: undefined });
    const container = await render(ready(bridge));
    await click(container, 'Add Key');
    await enterKey(container, 'sk-no-storage-method');
    await click(container, 'Save Key');
    expect(container.textContent).toContain('Secure key storage is unavailable.');

    act(() => mountedRoot?.unmount());
    mountedRoot = null;
    mountedContainer?.remove();
    mountedContainer = null;
    const failingStatus = makeBridge({ hasApiKey: vi.fn(async () => { throw new Error('IPC failed'); }) });
    const second = await render(ready(failingStatus.bridge));
    expect(second.textContent).toContain('API key status is unavailable.');
    expect(second.textContent).toContain('Unknown');
    await click(second, 'Add Key');
    await enterKey(second, 'sk-status-recovers-after-save');
    await click(second, 'Save Key');
    expect(second.textContent).toContain('Configured');
    expect(second.textContent).not.toContain('API key status is unavailable.');
  });

  it('clears the key draft when the settings editor closes', async () => {
    const { bridge } = makeBridge();
    const onClose = vi.fn();
    function CloseHarness() {
      const state = useSettings();
      return createElement(SettingsPanel, {
        settings: state.settings,
        displays: [],
        onPatch: state.patch,
        onRequestMode: state.setMode,
        onClose,
        hasApiKey: state.hasApiKey,
        onSaveApiKey: state.saveApiKey,
        onRemoveApiKey: state.removeApiKey,
        onTestConnection: state.testApiKeyConnection,
        error: state.error,
        saving: state.saving,
      });
    }
    mountedContainer = document.createElement('div');
    document.body.append(mountedContainer);
    mountedRoot = createRoot(mountedContainer);
    await act(async () => {
      mountedRoot?.render(
        createElement(BridgeContext.Provider, { value: ready(bridge) }, createElement(CloseHarness)),
      );
    });
    const container = mountedContainer;
    await click(container, 'Add Key');
    await enterKey(container, 'sk-close-test');
    await click(container, 'Close settings');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#deepseek-api-key')).toBeNull();
  });
});
