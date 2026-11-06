/// <reference types="vite/client" />

import type { CypsBridge, Mode } from '@shared/types';

declare global {
  interface Window {
    /**
     * Native bridge injected by the preload script. It is optional at runtime:
     * when the renderer runs in a plain browser there is no preload, so code
     * must always read it through `useBridge()` rather than assuming presence.
     */
    cyps?: CypsBridge;

    /**
     * Shell-originated notifications that are not part of the CypsBridge data
     * contract (the tray changing mode). Optional for the same reason.
     */
    cypsShell?: {
      onModeChanged(handler: (mode: Mode) => void): () => void;
    };
  }
}

export {};
