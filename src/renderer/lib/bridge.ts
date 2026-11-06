import type { CypsBridge } from '@shared/types';

/**
 * Result of probing for the native bridge.
 *
 * A discriminated union (rather than `CypsBridge | undefined`) keeps every
 * call site honest: TypeScript forces a narrowing before any bridge method is
 * touched, so a missing preload can never cause a runtime crash.
 */
export type BridgeStatus =
  | { readonly kind: 'ready'; readonly bridge: CypsBridge }
  | { readonly kind: 'missing'; readonly reason: string };

/** Probe for the preload-injected bridge. Safe to call at module load. */
export function readBridge(): BridgeStatus {
  if (typeof window === 'undefined') {
    return { kind: 'missing', reason: 'There is no browser window to host Cyps.' };
  }
  const bridge = window.cyps;
  if (bridge === undefined || bridge === null) {
    return {
      kind: 'missing',
      reason: 'The native bridge (window.cyps) was not injected by the preload script.',
    };
  }
  return { kind: 'ready', bridge };
}

/** Subscribe to a bridge event; returns a disposer. Swallows non-function stubs. */
export function safeSubscribe<T>(
  subscribe: ((listener: (value: T) => void) => void | (() => void)) | undefined,
  listener: (value: T) => void,
): () => void {
  if (typeof subscribe !== 'function') return () => undefined;
  let dispose: void | (() => void);
  try {
    dispose = subscribe(listener);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      if (typeof dispose === 'function') dispose();
    } catch {
      /* Disposer failures must never break teardown. */
    }
  };
}

/** Await a possibly-throwing promise without letting a rejection escape. */
export async function safeAwait<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await work();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
