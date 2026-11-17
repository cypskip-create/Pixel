import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, ConnectionTestResult, CypsError, Mode } from '@shared/types';
import { mergeSettings } from '@shared/types';
import { useBridge } from '@/hooks/useBridge';
import type { DeepPartial } from '@/components/SettingsPanel';

interface SettingsState {
  settings: AppSettings;
  hasApiKey: boolean | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
}

/**
 * Reads and writes AppSettings through the optional native bridge.
 *
 * The preload layer is written independently of this renderer, so every call
 * is defensive. API-key status is queried through its dedicated secure IPC
 * method; it is never inferred from or stored in AppSettings.
 */
export function useSettings() {
  const bridge = useBridge();
  const [state, setState] = useState<SettingsState>({
    settings: mergeSettings(null),
    hasApiKey: null,
    loading: bridge.kind === 'ready',
    error: bridge.kind === 'missing' ? bridge.reason : null,
    saving: false,
  });

  // Guards against setting state after the window tears down.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.settings;
    if (!api || typeof api.get !== 'function') {
      setState((prev) => ({ ...prev, loading: false, error: 'Settings are unavailable.' }));
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const settingsRead =
          typeof api.get === 'function'
            ? api.get()
            : Promise.reject(new Error('Settings are unavailable.'));
        // Do not rely on an optional field in AppSettings: the main process
        // returns the ordinary settings object and keeps key material separate.
        const keyStatusRead =
          typeof api.hasApiKey === 'function'
            ? api.hasApiKey()
            : Promise.reject(new Error('API key status is unavailable.'));
        const [settingsResult, keyStatusResult] = await Promise.allSettled([
          settingsRead,
          keyStatusRead,
        ]);
        if (cancelled || !alive.current) return;
        if (settingsResult.status === 'rejected') throw settingsResult.reason;

        // Keep compatibility with older wrappers, but always read status from
        // hasApiKey() above rather than trusting an envelope's extra field.
        const reply: unknown = settingsResult.value;
        const raw =
          reply !== null && typeof reply === 'object' && 'settings' in reply
            ? (reply as { settings?: unknown }).settings
            : reply;
        const hasApiKey =
          keyStatusResult.status === 'fulfilled' && typeof keyStatusResult.value === 'boolean'
            ? keyStatusResult.value
            : null;

        setState({
          settings: mergeSettings(raw),
          hasApiKey,
          loading: false,
          error:
            keyStatusResult.status === 'rejected' || hasApiKey === null
              ? 'API key status is unavailable.'
              : null,
          saving: false,
        });
      } catch (cause) {
        if (cancelled || !alive.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: `Could not load settings: ${describe(cause)}`,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const unsubscribeSettings = typeof bridge.bridge.settings.onChanged === 'function'
      ? bridge.bridge.settings.onChanged((next) => setState((previous) => ({ ...previous, settings: mergeSettings(next) })))
      : () => undefined;
    const unsubscribeKey = typeof bridge.bridge.settings.onApiKeyStatus === 'function'
      ? bridge.bridge.settings.onApiKeyStatus((configured) => setState((previous) => ({ ...previous, hasApiKey: configured })))
      : () => undefined;
    return () => { unsubscribeSettings(); unsubscribeKey(); };
  }, [bridge]);

  const patch = useCallback(
    (partial: DeepPartial<AppSettings>) => {
      // Optimistic local merge so the UI never lags behind the click.
      setState((prev) => ({
        ...prev,
        settings: mergeSettings({ ...prev.settings, ...partial }),
        saving: true,
        error: null,
      }));

      if (bridge.kind !== 'ready') {
        setState((prev) => ({
          ...prev,
          saving: false,
          error: 'Changes are not saved: the desktop bridge is unavailable.',
        }));
        return;
      }

      const api = bridge.bridge.settings;
      if (!api || typeof api.set !== 'function') {
        setState((prev) => ({
          ...prev,
          saving: false,
          error: 'Changes are not saved: settings storage is unavailable.',
        }));
        return;
      }

      void (async () => {
        try {
          const reply: unknown = await api.set(partial as Record<string, unknown>);
          if (!alive.current) return;
          // If the shell echoes the canonical settings, adopt them verbatim.
          const canonical =
            reply !== null && typeof reply === 'object' && 'settings' in reply
              ? (reply as { settings?: unknown }).settings
              : reply;
          setState((prev) => ({
            ...prev,
            settings: canonical === undefined ? prev.settings : mergeSettings(canonical),
            saving: false,
          }));
        } catch (cause) {
          if (!alive.current) return;
          setState((prev) => ({
            ...prev,
            saving: false,
            error: `Could not save: ${describe(cause)}`,
          }));
        }
      })();
    },
    [bridge],
  );

  const saveApiKey = useCallback(
    async (key: string): Promise<{ ok: boolean; error?: string }> => {
      if (bridge.kind !== 'ready') {
        return { ok: false, error: 'Secure key storage is unavailable.' };
      }
      const method = bridge.bridge.settings?.setApiKey;
      if (typeof method !== 'function') {
        return { ok: false, error: 'Secure key storage is unavailable.' };
      }
      try {
        const result: unknown = await method(key);
        if (result === null || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
          const message =
            result !== null && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
              ? result.error
              : 'Pixel could not save the API key securely.';
          return { ok: false, error: message };
        }
        if (alive.current) {
          setState((prev) => ({
            ...prev,
            hasApiKey: true,
            error: prev.error === 'API key status is unavailable.' ? null : prev.error,
          }));
        }
        return { ok: true };
      } catch {
        // Avoid showing arbitrary IPC exception text, which must never echo a
        // credential back into renderer UI or logs.
        return { ok: false, error: 'Pixel could not save the API key securely.' };
      }
    },
    [bridge],
  );

  const removeApiKey = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (bridge.kind !== 'ready') {
      return { ok: false, error: 'Secure key storage is unavailable.' };
    }
    const method = bridge.bridge.settings?.clearApiKey;
    if (typeof method !== 'function') {
      return { ok: false, error: 'Secure key storage is unavailable.' };
    }
    try {
      await method();
      if (alive.current) {
        setState((prev) => ({
          ...prev,
          hasApiKey: false,
          error: prev.error === 'API key status is unavailable.' ? null : prev.error,
        }));
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Pixel could not remove the saved API key.' };
    }
  }, [bridge]);

  const testApiKeyConnection = useCallback(async (): Promise<ConnectionTestResult> => {
    if (bridge.kind !== 'ready') {
      return { ok: false, error: connectionError('UNKNOWN', 'The native bridge is unavailable.') };
    }
    const method = bridge.bridge.settings?.testConnection;
    if (typeof method !== 'function') {
      return { ok: false, error: connectionError('UNKNOWN', 'Connection testing is unavailable.') };
    }
    try {
      const result: unknown = await method();
      if (result !== null && typeof result === 'object' && 'ok' in result && typeof result.ok === 'boolean') {
        return result as ConnectionTestResult;
      }
      return { ok: false, error: connectionError('UNKNOWN', 'DeepSeek returned an invalid connection result.') };
    } catch {
      return { ok: false, error: connectionError('UNKNOWN', 'Connection testing is unavailable.') };
    }
  }, [bridge]);

  const setMode = useCallback(
    (mode: Mode) => {
      patch({ companion: { mode } });
    },
    [patch],
  );

  return { ...state, patch, setMode, saveApiKey, removeApiKey, testApiKeyConnection };
}

function connectionError(code: CypsError['code'], message: string): CypsError {
  return { code, message, retryable: false };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'unknown error';
}
