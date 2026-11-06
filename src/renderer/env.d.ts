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
     * contract (the tray changing mode, and local speech services). Optional
     * for the same reason.
     */
    cypsShell?: {
      onModeChanged(handler: (mode: Mode) => void): () => void;
      voiceCapability(): Promise<{
        speechToText: boolean;
        textToSpeech: boolean;
        reason?: string;
      }>;
      voiceListen(timeoutMs?: number): Promise<{
        ok: boolean;
        text: string;
        confidence: number;
        error?: string;
        noSpeech?: boolean;
      }>;
      voiceSpeak(text: string): Promise<{ ok: boolean; error?: string }>;
    };
  }
}

export {};
