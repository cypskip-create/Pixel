import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, Mode } from '@shared/types';
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
 * is defensive: the reply may be an AppSettings, or a `{settings, hasApiKey}`
 * envelope, or absent entirely. A missing or failing bridge degrades to
 * defaults plus a visible error rather than a crash.
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
        const reply: unknown = await api.get();
        if (cancelled || !alive.current) return;

        // Accept both a bare AppSettings and a { settings, hasApiKey } envelope.
        let raw: unknown = reply;
        let hasApiKey: boolean | null = null;
        if (reply !== null && typeof reply === 'object' && 'settings' in reply) {
          const envelope = reply as { settings?: unknown; hasApiKey?: unknown };
          raw = envelope.settings;
          if (typeof envelope.hasApiKey === 'boolean') hasApiKey = envelope.hasApiKey;
        }

        setState({
          settings: mergeSettings(raw),
          hasApiKey,
          loading: false,
          error: null,
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

  const setMode = useCallback(
    (mode: Mode) => {
      patch({ companion: { mode } });
    },
    [patch],
  );

  return { ...state, patch, setMode };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'unknown error';
}
