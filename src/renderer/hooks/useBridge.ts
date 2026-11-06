import { createContext, useContext } from 'react';
import type { BridgeStatus } from '@/lib/bridge';

/**
 * Provided once by <App> so components never reach into `window` directly.
 * Keeps the "is the bridge present?" decision in a single place.
 */
export const BridgeContext = createContext<BridgeStatus>({
  kind: 'missing',
  reason: 'Bridge context was not provided.',
});

export function useBridge(): BridgeStatus {
  return useContext(BridgeContext);
}
