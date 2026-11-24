/**
 * Multi-provider Speech-to-Text (STT) and Text-to-Speech (TTS) adapters.
 *
 * Adapted from Hermes `tools/tts_tool_providers.py`, `tools/tts_tool_openai.py`,
 * and `tools/transcription_audio.py`:
 *  - Enforces strict local-only privacy when a local provider is selected
 *    (never silently sends audio to a cloud endpoint).
 *  - Caps upstream TTS audio bodies at 16 MiB (`TTS_RESPONSE_BODY_LIMIT_BYTES`).
 *  - Supports OpenAI, Mistral, Deepgram, and custom OpenAI-compat STT;
 *    System, Kokoro, Edge, OpenAI, ElevenLabs, xAI, Gemini, MiniMax, and Mistral TTS.
 *  - Provides deterministic sentence-boundary segmentation for streaming TTS.
 */

export const STT_PROVIDERS = ['local', 'openai', 'mistral', 'deepgram', 'custom'] as const;
export type SttProviderId = (typeof STT_PROVIDERS)[number];

export const TTS_PROVIDERS = [
  'system',
  'kokoro',
  'edge',
  'openai',
  'elevenlabs',
  'xai',
  'gemini',
  'minimax',
  'mistral',
] as const;
export type TtsProviderId = (typeof TTS_PROVIDERS)[number];

export const TTS_RESPONSE_BODY_LIMIT_BYTES = 16 * 1024 * 1024;
export const MAX_STT_AUDIO_BYTES = 25 * 1024 * 1024;

export interface CloudSttRequest {
  provider: SttProviderId;
  audioBuffer: Buffer;
  mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/webm' | 'audio/ogg';
  apiKey?: string | null;
  baseUrl?: string;
  model?: string;
  language?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface CloudSttResult {
  ok: boolean;
  provider: SttProviderId;
  text?: string;
  language?: string;
  error?: string;
}

export interface CloudTtsRequest {
  provider: TtsProviderId;
  text: string;
  apiKey?: string | null;
  baseUrl?: string;
  voice?: string;
  model?: string;
  rate?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface CloudTtsResult {
  ok: boolean;
  provider: TtsProviderId;
  audioBase64?: string;
  mimeType?: string;
  byteLength?: number;
  error?: string;
}

async function readBoundedBytes(response: Response, limitBytes: number): Promise<Buffer> {
  if (!response.body) {
    const arr = Buffer.from(await response.arrayBuffer());
    if (arr.byteLength > limitBytes) {
      throw new Error(`Audio response exceeded ${Math.round(limitBytes / (1024 * 1024))} MiB limit.`);
    }
    return arr;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Audio response exceeded ${Math.round(limitBytes / (1024 * 1024))} MiB limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Split streaming assistant text into natural speakable sentence segments
 * without breaking abbreviations or code blocks awkwardly.
 */
export function splitIntoSpeechSegments(text: string, maxChars = 240): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const rawSentences = cleaned.split(/(?<=[.!?])\s+/);
  const segments: string[] = [];
  let current = '';

  for (const sentence of rawSentences) {
    if (!sentence) continue;
    if (current && current.length + 1 + sentence.length > maxChars) {
      segments.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

export async function transcribeWithCloudProvider(req: CloudSttRequest): Promise<CloudSttResult> {
  if (req.provider === 'local') {
    return {
      ok: false,
      provider: 'local',
      error: 'Local STT selected: audio stays on-device and is never sent to a cloud endpoint.',
    };
  }
  if (!req.audioBuffer || req.audioBuffer.byteLength === 0) {
    return { ok: false, provider: req.provider, error: 'Audio recording is empty.' };
  }
  if (req.audioBuffer.byteLength > MAX_STT_AUDIO_BYTES) {
    return { ok: false, provider: req.provider, error: 'Audio recording exceeds the 25 MiB limit.' };
  }
  const key = (req.apiKey ?? '').trim();
  if (!key) {
    return { ok: false, provider: req.provider, error: `Missing API key for STT provider "${req.provider}".` };
  }

  const doFetch = req.fetchImpl ?? fetch;

  if (req.provider === 'deepgram') {
    const langParam = req.language && req.language !== 'auto' ? `&language=${encodeURIComponent(req.language)}` : '&detect_language=true';
    const url = `${(req.baseUrl || 'https://api.deepgram.com/v1').replace(/\/+$/, '')}/listen?model=${encodeURIComponent(req.model || 'nova-2')}${langParam}`;
    const resp = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': req.mimeType,
      },
      body: new Uint8Array(req.audioBuffer),
      signal: req.signal,
    });
    if (!resp.ok) {
      return { ok: false, provider: 'deepgram', error: `Deepgram STT failed (HTTP ${resp.status}).` };
    }
    const json = (await resp.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
    return { ok: true, provider: 'deepgram', text, language: req.language };
  }

  // OpenAI / Mistral / Custom OpenAI-compatible multipart transcription endpoint.
  const defaultBase =
    req.provider === 'mistral' ? 'https://api.mistral.ai/v1' : 'https://api.openai.com/v1';
  const url = `${(req.baseUrl || defaultBase).replace(/\/+$/, '')}/audio/transcriptions`;
  const form = new FormData();
  const ext = req.mimeType === 'audio/mpeg' ? 'mp3' : req.mimeType === 'audio/webm' ? 'webm' : 'wav';
  form.append('file', new Blob([new Uint8Array(req.audioBuffer)], { type: req.mimeType }), `audio.${ext}`);
  form.append('model', req.model || (req.provider === 'mistral' ? 'voxtral-mini-latest' : 'whisper-1'));
  if (req.language && req.language !== 'auto') {
    form.append('language', req.language);
  }

  const resp = await doFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: req.signal,
  });
  if (!resp.ok) {
    return { ok: false, provider: req.provider, error: `${req.provider} STT failed (HTTP ${resp.status}).` };
  }
  const json = (await resp.json()) as { text?: string; language?: string };
  return {
    ok: true,
    provider: req.provider,
    text: (json.text ?? '').trim(),
    language: json.language ?? req.language,
  };
}

export async function synthesizeWithCloudProvider(req: CloudTtsRequest): Promise<CloudTtsResult> {
  if (req.provider === 'system' || req.provider === 'kokoro') {
    return {
      ok: false,
      provider: req.provider,
      error: `Local TTS provider "${req.provider}" runs on-device via VoiceService.`,
    };
  }
  const text = req.text.trim();
  if (!text) return { ok: false, provider: req.provider, error: 'Cannot synthesize empty text.' };
  const key = (req.apiKey ?? '').trim();
  if (req.provider !== 'edge' && !key) {
    return { ok: false, provider: req.provider, error: `Missing API key for TTS provider "${req.provider}".` };
  }

  const doFetch = req.fetchImpl ?? fetch;

  try {
    if (req.provider === 'elevenlabs') {
      const voiceId = req.voice || 'pNInz6obpgDQGcFmaJgB';
      const url = `${(req.baseUrl || 'https://api.elevenlabs.io/v1').replace(/\/+$/, '')}/text-to-speech/${encodeURIComponent(voiceId)}`;
      const resp = await doFetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: req.model || 'eleven_multilingual_v2',
        }),
        signal: req.signal,
      });
      if (!resp.ok) return { ok: false, provider: 'elevenlabs', error: `ElevenLabs TTS failed (HTTP ${resp.status}).` };
      const buf = await readBoundedBytes(resp, TTS_RESPONSE_BODY_LIMIT_BYTES);
      return { ok: true, provider: 'elevenlabs', audioBase64: buf.toString('base64'), mimeType: 'audio/mpeg', byteLength: buf.byteLength };
    }

    if (req.provider === 'gemini') {
      const model = req.model || 'gemini-2.5-flash-preview-tts';
      const url = `${(req.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent`;
      const resp = await doFetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice || 'Kore' } },
            },
          },
        }),
        signal: req.signal,
      });
      if (!resp.ok) return { ok: false, provider: 'gemini', error: `Gemini TTS failed (HTTP ${resp.status}).` };
      const json = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
      };
      const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inline?.data) return { ok: false, provider: 'gemini', error: 'Gemini TTS returned no audio payload.' };
      const bytes = Buffer.from(inline.data, 'base64');
      if (bytes.byteLength > TTS_RESPONSE_BODY_LIMIT_BYTES) {
        return { ok: false, provider: 'gemini', error: 'Gemini TTS audio exceeded 16 MiB limit.' };
      }
      return { ok: true, provider: 'gemini', audioBase64: inline.data, mimeType: inline.mimeType || 'audio/wav', byteLength: bytes.byteLength };
    }

    if (req.provider === 'minimax') {
      const url = req.baseUrl || 'https://api.minimax.io/v1/t2a_v2';
      const resp = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model || 'speech-02-hd',
          text,
          voice_setting: { voice_id: req.voice || 'English_expressive_narrator', speed: req.rate ?? 1.0 },
        }),
        signal: req.signal,
      });
      if (!resp.ok) return { ok: false, provider: 'minimax', error: `MiniMax TTS failed (HTTP ${resp.status}).` };
      const json = (await resp.json()) as { data?: { audio?: string } };
      if (!json.data?.audio) return { ok: false, provider: 'minimax', error: 'MiniMax TTS returned no audio hex payload.' };
      const buf = Buffer.from(json.data.audio, 'hex');
      if (buf.byteLength > TTS_RESPONSE_BODY_LIMIT_BYTES) {
        return { ok: false, provider: 'minimax', error: 'MiniMax TTS audio exceeded 16 MiB limit.' };
      }
      return { ok: true, provider: 'minimax', audioBase64: buf.toString('base64'), mimeType: 'audio/mpeg', byteLength: buf.byteLength };
    }

    // OpenAI / xAI / Mistral / Edge-compatible `/audio/speech` contract.
    const defaultBase =
      req.provider === 'xai'
        ? 'https://api.x.ai/v1'
        : req.provider === 'mistral'
          ? 'https://api.mistral.ai/v1'
          : 'https://api.openai.com/v1';
    const url = `${(req.baseUrl || defaultBase).replace(/\/+$/, '')}/audio/speech`;
    const body: Record<string, unknown> = {
      model:
        req.model ||
        (req.provider === 'mistral'
          ? 'voxtral-mini-tts-2603'
          : req.provider === 'xai'
            ? 'grok-tts'
            : 'gpt-4o-mini-tts'),
      voice:
        req.voice ||
        (req.provider === 'xai'
          ? 'eve'
          : req.provider === 'edge'
            ? 'en-US-AriaNeural'
            : 'alloy'),
      input: text,
      response_format: 'mp3',
    };
    if (typeof req.rate === 'number' && req.rate !== 1.0) {
      body.speed = Math.min(1.5, Math.max(0.7, req.rate));
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;

    const resp = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!resp.ok) return { ok: false, provider: req.provider, error: `${req.provider} TTS failed (HTTP ${resp.status}).` };
    const buf = await readBoundedBytes(resp, TTS_RESPONSE_BODY_LIMIT_BYTES);
    return { ok: true, provider: req.provider, audioBase64: buf.toString('base64'), mimeType: 'audio/mpeg', byteLength: buf.byteLength };
  } catch (err) {
    return {
      ok: false,
      provider: req.provider,
      error: err instanceof Error ? err.message : `${req.provider} TTS synthesis failed.`,
    };
  }
}
