/**
 * Renderer-side Continuous Voice & Full-Duplex GPT-Live WebRTC session controllers.
 *
 * Security & privacy invariants:
 *  - API keys NEVER enter the renderer. GPT-Live SDP negotiation goes strictly
 *    through `window.cypsShell.voiceGptLiveOffer(sdpOffer)` -> Electron main ->
 *    Python `voice.gpt_live_sdp` (`POST /v1/realtime`).
 *  - Substantive tool/action requests from GPT-Live data-channel events are
 *    delegated to Pixel's primary Python agent via `onDelegatePrompt`.
 */

export type LiveVoiceConnectionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speech_detected'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'muted'
  | 'disconnected'
  | 'error';

export interface GptLiveSessionCallbacks {
  onStateChange?: (state: LiveVoiceConnectionState, detail?: string) => void;
  onTranscript?: (role: 'user' | 'assistant', text: string) => void;
  onDelegatePrompt?: (prompt: string) => Promise<string>;
}

interface ShellVoiceBridge {
  voiceGptLiveOffer?: (sdpOffer: string) => Promise<{
    ok: boolean;
    sdpAnswer?: string;
    model?: string;
    voice?: string;
    error?: string;
  }>;
  voiceContinuousStart?: () => Promise<{ ok: boolean; state: string; error?: string }>;
  voiceContinuousStop?: () => Promise<{ ok: boolean; state: string }>;
  voiceContinuousFrame?: (rms: number, speaking?: boolean) => Promise<{ state: string; event: string | null }>;
}

function getShellBridge(): ShellVoiceBridge {
  return ((globalThis as unknown as { cypsShell?: ShellVoiceBridge }).cypsShell) ?? {};
}

/**
 * Full-duplex WebRTC session controller for OpenAI GPT-Live.
 * Uses browser-native `RTCPeerConnection` + `MediaStream` while keeping
 * credentials strictly inside Electron main / Python.
 */
export class GptLiveWebRtcSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private state: LiveVoiceConnectionState = 'idle';
  private muted = false;

  constructor(private readonly callbacks: GptLiveSessionCallbacks = {}) {}

  getState(): LiveVoiceConnectionState {
    return this.state;
  }

  private setState(next: LiveVoiceConnectionState, detail?: string): void {
    this.state = next;
    this.callbacks.onStateChange?.(next, detail);
  }

  async connect(): Promise<{ ok: boolean; error?: string }> {
    const shell = getShellBridge();
    if (!shell.voiceGptLiveOffer) {
      this.setState('error', 'GPT-Live IPC bridge is unavailable.');
      return { ok: false, error: 'GPT-Live IPC bridge is unavailable.' };
    }
    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.setState('error', 'WebRTC or microphone capture is unavailable in this environment.');
      return { ok: false, error: 'WebRTC or microphone capture is unavailable.' };
    }

    this.setState('connecting');
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const pc = new RTCPeerConnection();
      this.pc = pc;

      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      this.remoteAudio = audioEl;
      pc.ontrack = (evt) => {
        if (evt.streams[0]) {
          audioEl.srcObject = evt.streams[0];
          this.setState('speaking');
        }
      };

      const dc = pc.createDataChannel('oai-events');
      this.dc = dc;
      dc.onopen = () => this.setState('listening');
      dc.onclose = () => this.setState('disconnected');
      dc.onmessage = (evt) => {
        void this.handleDataChannelEvent(String(evt.data ?? ''));
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const negotiated = await shell.voiceGptLiveOffer(offer.sdp ?? '');
      if (!negotiated.ok || !negotiated.sdpAnswer) {
        await this.disconnect();
        this.setState('error', negotiated.error ?? 'GPT-Live negotiation failed.');
        return { ok: false, error: negotiated.error ?? 'GPT-Live negotiation failed.' };
      }

      await pc.setRemoteDescription({ type: 'answer', sdp: negotiated.sdpAnswer });
      this.setState('listening');
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.disconnect();
      this.setState('error', msg);
      return { ok: false, error: msg };
    }
  }

  private async handleDataChannelEvent(raw: string): Promise<void> {
    try {
      const parsed = JSON.parse(raw) as { type?: string; transcript?: string; text?: string; prompt?: string };
      if (parsed.type === 'conversation.item.input_audio_transcription.completed' && parsed.transcript) {
        this.callbacks.onTranscript?.('user', parsed.transcript);
      } else if (parsed.type === 'response.audio_transcript.done' && parsed.transcript) {
        this.callbacks.onTranscript?.('assistant', parsed.transcript);
        this.setState('listening');
      } else if (parsed.type === 'pixel.delegate' && parsed.prompt && this.callbacks.onDelegatePrompt) {
        this.setState('thinking');
        const reply = await this.callbacks.onDelegatePrompt(parsed.prompt);
        this.sendEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: reply }] } });
        this.sendEvent({ type: 'response.create' });
      }
    } catch {
      // Ignore non-JSON control frames.
    }
  }

  sendEvent(payload: Record<string, unknown>): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(JSON.stringify(payload));
    return true;
  }

  interrupt(): void {
    this.sendEvent({ type: 'response.cancel' });
    this.setState('interrupted');
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
    this.setState(muted ? 'muted' : 'listening');
  }

  isMuted(): boolean {
    return this.muted;
  }

  async disconnect(): Promise<void> {
    try {
      this.dc?.close();
    } catch {
      // Ignore close race
    }
    try {
      this.pc?.close();
    } catch {
      // Ignore close race
    }
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
    }
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }
    this.dc = null;
    this.pc = null;
    this.localStream = null;
    this.remoteAudio = null;
    if (this.state !== 'error') this.setState('disconnected');
  }
}

/**
 * Continuous Chained Voice client connecting browser microphone RMS frames to
 * Electron main's `ContinuousVoiceController` (`voice:continuousStart/Frame/Stop`).
 */
export class ContinuousVoiceClient {
  private active = false;

  async start(): Promise<{ ok: boolean; state: string; error?: string }> {
    const shell = getShellBridge();
    if (!shell.voiceContinuousStart) {
      return { ok: false, state: 'idle', error: 'Continuous voice IPC is unavailable.' };
    }
    const res = await shell.voiceContinuousStart();
    this.active = res.ok;
    return res;
  }

  async sendRmsFrame(rms: number, speaking?: boolean): Promise<{ state: string; event: string | null }> {
    const shell = getShellBridge();
    if (!this.active || !shell.voiceContinuousFrame) {
      return { state: 'idle', event: null };
    }
    return shell.voiceContinuousFrame(rms, speaking);
  }

  async stop(): Promise<{ ok: boolean; state: string }> {
    this.active = false;
    const shell = getShellBridge();
    if (!shell.voiceContinuousStop) {
      return { ok: true, state: 'idle' };
    }
    return shell.voiceContinuousStop();
  }
}
