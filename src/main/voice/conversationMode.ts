/**
 * Continuous Voice Conversation Controller, Barge-In / Echo Suppression &
 * Full-Duplex GPT-Live SDP Session Broker.
 *
 * Adapted from Hermes `hermes_cli/config_defaults_voice.py`,
 * `tools/voice_mode.py`, and `tools/voice_live.py`:
 *  - Chained voice conversation state machine (`idle` -> `listening` ->
 *    `speech_detected` -> `transcribing` -> `thinking` -> `speaking` -> `interrupted`).
 *  - Pre-playback quiet-room RMS floor calibration + grace period (`0.5s`) +
 *    multiplier (`3.0x`) so Pixel's own speech never self-triggers barge-in.
 *  - Stop-phrase detection (case-insensitive, punctuation stripped).
 *  - Server-side OpenAI GPT-Live SDP offer/answer exchange (`POST /v1/live/sessions`)
 *    keeping the API key strictly in Electron main (never sent to the renderer).
 */

export const GPT_LIVE_VOICES = [
  'marin',
  'cedar',
  'quartz',
  'ripple',
  'vesper',
  'willow',
  'stone',
  'gleam',
  'meridian',
  'bossa',
  'tempo',
  'beacon',
  'delta',
  'cinder',
] as const;
export type GptLiveVoice = (typeof GPT_LIVE_VOICES)[number];

export type VoiceSessionPhase =
  | 'idle'
  | 'listening'
  | 'speech_detected'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export interface VoiceConversationConfig {
  mode: 'chained' | 'gpt-live';
  silenceThreshold: number;
  silenceDurationSec: number;
  bargeIn: boolean;
  bargeInGraceSec: number;
  bargeInThresholdMultiplier: number;
  stopPhrases: string[];
}

export const DEFAULT_VOICE_CONVERSATION_CONFIG: VoiceConversationConfig = {
  mode: 'chained',
  silenceThreshold: 200,
  silenceDurationSec: 3.0,
  bargeIn: true,
  bargeInGraceSec: 0.5,
  bargeInThresholdMultiplier: 3.0,
  stopPhrases: ['stop'],
};

export const PIXEL_LIVE_PERSONA =
  'You are Pixel, a calm and helpful Windows desktop voice assistant. Speak naturally and concisely. ' +
  'Stop speaking immediately when the user interrupts. ' +
  'Delegate all factual queries, file/code/git operations, browser tasks, and Windows actions to the Pixel agent backend; never guess tool results.';

export const VOICE_LIVE_TURN_NOTE =
  '[Note: this message is delegated from a live spoken conversation. Answer in plain conversational sentences without markdown or code blocks; execute real tools as needed and report verified outcomes concisely.]';

export function formatVoiceLiveTurnNote(recentContext = ''): string {
  const trimmed = recentContext.trim();
  if (!trimmed) return VOICE_LIVE_TURN_NOTE;
  return `${VOICE_LIVE_TURN_NOTE}\n[Recent spoken conversation:\n${trimmed}]`;
}

export function isVoiceStopPhrase(transcript: string, stopPhrases: readonly string[]): boolean {
  const normalized = transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
  if (!normalized) return false;
  return stopPhrases.some((p) => p.trim().toLowerCase() === normalized);
}

/**
 * Deterministic barge-in & silence detector for continuous voice turns.
 * Prevents self-triggering during TTS onset via grace period + pre-playback noise floor.
 */
export class ContinuousVoiceController {
  private phase: VoiceSessionPhase = 'idle';
  private noiseFloorRms = 120;
  private ttsStartedAt = 0;
  private silenceStartedAt: number | null = null;

  constructor(
    private config: VoiceConversationConfig = DEFAULT_VOICE_CONVERSATION_CONFIG,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getPhase(): VoiceSessionPhase {
    return this.phase;
  }

  updateConfig(patch: Partial<VoiceConversationConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  start(): void {
    this.phase = 'listening';
    this.silenceStartedAt = null;
  }

  stop(): void {
    this.phase = 'idle';
    this.silenceStartedAt = null;
    this.ttsStartedAt = 0;
  }

  calibrateNoiseFloor(rms: number): void {
    if (Number.isFinite(rms) && rms > 0) {
      this.noiseFloorRms = Math.max(50, Math.min(rms, 8000));
    }
  }

  beginSpeaking(): void {
    this.phase = 'speaking';
    this.ttsStartedAt = this.now();
  }

  /**
   * Process one microphone RMS frame.
   * Returns `'end_of_speech'` when silence duration elapsed after speech,
   * `'barge_in'` when user interrupts speaking past the grace period & echo floor,
   * or `null` otherwise.
   */
  ingestMicRms(rms: number): 'end_of_speech' | 'barge_in' | null {
    const t = this.now();

    if (this.phase === 'speaking') {
      if (!this.config.bargeIn) return null;
      const elapsedSec = (t - this.ttsStartedAt) / 1000;
      if (elapsedSec < this.config.bargeInGraceSec) return null;
      const triggerLevel = Math.max(
        this.config.silenceThreshold,
        this.noiseFloorRms * this.config.bargeInThresholdMultiplier,
      );
      if (rms >= triggerLevel) {
        this.phase = 'interrupted';
        this.silenceStartedAt = null;
        return 'barge_in';
      }
      return null;
    }

    if (this.phase === 'listening' || this.phase === 'interrupted') {
      if (rms >= this.config.silenceThreshold) {
        this.phase = 'speech_detected';
        this.silenceStartedAt = null;
      } else {
        this.calibrateNoiseFloor(rms);
      }
      return null;
    }

    if (this.phase === 'speech_detected') {
      if (rms < this.config.silenceThreshold) {
        if (this.silenceStartedAt === null) {
          this.silenceStartedAt = t;
        } else if ((t - this.silenceStartedAt) / 1000 >= this.config.silenceDurationSec) {
          this.phase = 'transcribing';
          this.silenceStartedAt = null;
          return 'end_of_speech';
        }
      } else {
        this.silenceStartedAt = null;
      }
    }

    return null;
  }
}

export interface GptLiveSdpExchangeRequest {
  sdpOffer: string;
  apiKey: string | null;
  model?: string;
  voice?: string;
  instructions?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface GptLiveSdpExchangeResult {
  ok: boolean;
  sdpAnswer?: string;
  model?: string;
  voice?: string;
  error?: string;
}

/**
 * Server-side WebRTC SDP offer/answer exchange for OpenAI GPT-Live full-duplex voice
 * (`POST /v1/live/sessions`). Keeps the OpenAI API key strictly in Electron main.
 */
export async function exchangeGptLiveSdpOffer(
  req: GptLiveSdpExchangeRequest,
): Promise<GptLiveSdpExchangeResult> {
  const key = (req.apiKey ?? '').trim();
  if (!key) {
    return { ok: false, error: 'OpenAI API key is required for GPT-Live full-duplex voice mode.' };
  }
  const offer = req.sdpOffer.trim();
  if (!offer) {
    return { ok: false, error: 'Missing WebRTC SDP offer.' };
  }

  const model = (req.model || 'gpt-live-1').trim();
  const voice = (req.voice || 'marin').trim();
  const instructions = req.instructions?.trim()
    ? `${PIXEL_LIVE_PERSONA}\n\n${req.instructions.trim()}`
    : PIXEL_LIVE_PERSONA;

  const base = (req.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const doFetch = req.fetchImpl ?? fetch;

  try {
    const resp = await doFetch(`${base}/live/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        instructions,
        sdp_offer: offer,
        delegation_mode: 'client',
      }),
      signal: req.signal,
    });
    if (!resp.ok) {
      return { ok: false, error: `GPT-Live session exchange failed (HTTP ${resp.status}).` };
    }
    const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('application/sdp') || contentType.includes('text/plain')) {
      return { ok: true, sdpAnswer: await resp.text(), model, voice };
    }
    const json = (await resp.json()) as { sdp_answer?: string; answer?: { sdp?: string } };
    const sdpAnswer = json.sdp_answer ?? json.answer?.sdp;
    if (!sdpAnswer) return { ok: false, error: 'GPT-Live endpoint returned no SDP answer.' };
    return { ok: true, sdpAnswer, model, voice };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'GPT-Live SDP exchange failed.',
    };
  }
}
