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
     * contract (the tray changing mode, local speech services and the narrow
     * push-to-talk lifecycle). Optional
     * for the same reason.
     */
    cypsShell?: {
      onModeChanged(handler: (mode: Mode) => void): () => void;
      getPushToTalkStatus(): Promise<{ accelerator: string; ok: boolean; reason?: string } | null>;
      onPushToTalkState(handler: (event: {
        state: 'starting' | 'recording' | 'stopping' | 'transcribing' | 'submitting' | 'failed' | 'cancelled';
        error?: string;
        sessionId?: number;
      }) => void): () => void;
      onPushToTalkStopCapture(handler: (event: { sessionId: number; action: 'submit' | 'cancel' }) => void): () => void;
      voicePttCaptureReady(sessionId: number, error?: string): Promise<boolean>;
      voicePttTranscribe(sessionId: number, audio: Uint8Array): Promise<{ ok: boolean; error?: string }>;
      voiceTranscribeWav(audio: Uint8Array): Promise<{
        ok: boolean; text: string; confidence: number; error?: string; noSpeech?: boolean;
      }>;
      voiceCaptureAcquire(): Promise<boolean>;
      voiceCaptureRelease(): Promise<boolean>;
      onVoiceCaptureCancel(handler: () => void): () => void;
      onPushToTalkSubmit(handler: (request: { sessionId: number; text: string }) => void): () => void;
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
      voiceCancel(): Promise<number>;
      voiceSpeak(text: string): Promise<{ ok: boolean; error?: string }>;
    };
  }
}

export {};
