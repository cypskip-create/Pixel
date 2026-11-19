/**
 * Voice input and output.
 *
 * Uses Windows' built-in `System.Speech` for dictation/synthesis when present.
 * An optional Python `faster-whisper` worker can transcribe captured WAV input
 * with a model already present in the local cache; it never downloads one.
 *
 * If no recognizer or voice is installed, the capability check says exactly
 * that. Pixel never returns invented transcription.
 *
 * Audio never leaves the machine: recognition runs entirely locally.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminateProcessTree } from '../services/process';
import type { PythonWorker } from '../services/python-worker';
import type { VoiceSettings } from '../../shared/types';
import type { VoiceModelManager } from './models';

/** Longest live push-to-talk window. Renderer dictation uses a WAV stream. */
export const MAX_LISTEN_MS = 20_000;
/** At most 120 seconds of mono 16 kHz PCM plus its WAV header. */
export const MAX_VOICE_AUDIO_MS = 120_000;
export const MAX_VOICE_WAV_BYTES = 44 + 16_000 * 2 * 120;
export const MAX_VOICE_DIAGNOSTIC_WAV_BYTES = 44 + 16_000 * 2 * 30;

export interface VoiceCapability {
  speechToText: boolean;
  textToSpeech: boolean;
  reason?: string;
}

export interface RecognitionResult {
  ok: boolean;
  text: string;
  /** Present only when the active recognizer reports a real confidence value. */
  confidence?: number;
  language?: string;
  model?: string;
  backend?: string;
  audioSeconds?: number;
  processingMs?: number;
  error?: string;
  /** True when the recognizer heard nothing rather than failing. */
  noSpeech?: boolean;
}

export interface SpeechResult {
  ok: boolean;
  error?: string;
  backend?: string;
  generationMs?: number;
  playbackMs?: number;
  elapsedMs?: number;
}

export class VoiceService {
  private speaking = false;
  private playbackActive = false;
  private readonly activeControllers = new Set<AbortController>();
  private capabilityCache: VoiceCapability | null = null;
  private capabilityPending: Promise<VoiceCapability> | null = null;

  constructor(private readonly pythonWorker?: PythonWorker, private readonly voiceModels?: VoiceModelManager) {
    // A forced process exit can bypass finally; delete only Pixel's generated
    // short-lived voice buffers from an earlier run when the service restarts.
    try {
      for (const name of readdirSync(tmpdir())) {
        const match = /^pixel-voice-(?:tts-)?(\d+)-[a-f0-9-]+\.wav$/i.exec(name);
        if (match && Number(match[1]) !== process.pid) {
          try { unlinkSync(join(tmpdir(), name)); } catch { /* leave files owned by another active Pixel process */ }
        }
      }
    } catch { /* temp cleanup is best-effort; no audio is kept in app data */ }
  }

  /** Cancel current recognition and speech workers. */
  cancelAll(): number {
    const controllers = [...this.activeControllers];
    for (const controller of controllers) controller.abort();
    return controllers.length;
  }

  hasActiveOperations(): boolean {
    return this.activeControllers.size > 0;
  }

  async installedSystemVoices(): Promise<string[]> {
    if (process.platform !== 'win32') return [];
    try {
      const output = await runPowerShell(VOICES_SCRIPT, 10_000);
      const parsed: unknown = JSON.parse(output.trim());
      return Array.isArray(parsed)
        ? parsed.filter((name): name is string => typeof name === 'string' && name.length <= 160).slice(0, 64)
        : [];
    } catch {
      return [];
    }
  }

  /** Probe the machine once and cache the answer. */
  capability(): Promise<VoiceCapability> {
    if (this.capabilityCache) return Promise.resolve(this.capabilityCache);
    if (this.capabilityPending) return this.capabilityPending;
    this.capabilityPending = this.probeCapability().then((capability) => {
      this.capabilityCache = capability;
      return capability;
    }).finally(() => { this.capabilityPending = null; });
    return this.capabilityPending;
  }

  private async probeCapability(): Promise<VoiceCapability> {
    if (process.platform !== 'win32') {
      return {
        speechToText: false,
        textToSpeech: false,
        reason: 'Voice is only supported on Windows.',
      };
    }

    try {
      const [systemResult, pythonResult, modelResult, ttsAssets] = await Promise.allSettled([
        runPowerShell(CAPABILITY_SCRIPT, 15_000).then(parseCapability),
        this.pythonWorker?.capabilities() ?? Promise.resolve(null),
        this.voiceModels?.list() ?? Promise.resolve([]),
        this.voiceModels?.getTtsAssets() ?? Promise.resolve(null),
      ]);
      const system = systemResult.status === 'fulfilled' ? systemResult.value : null;
      const python = pythonResult.status === 'fulfilled' && pythonResult.value?.ok
        ? pythonResult.value.result
        : null;
      const fasterWhisper = python?.optional.faster_whisper === true;
      const models = modelResult.status === 'fulfilled' ? modelResult.value : [];
      const localSttReady = fasterWhisper && models.some((item) => item.kind === 'stt' && item.valid);
      const localTtsReady = ttsAssets.status === 'fulfilled' && ttsAssets.value !== null && python?.optional.kokoro_onnx === true;
      const speechToText = Boolean(system?.speechToText || localSttReady);
      const textToSpeech = Boolean(system?.textToSpeech || localTtsReady);
      if (!speechToText && !textToSpeech) {
        return {
          speechToText: false,
          textToSpeech: false,
          reason: 'No downloaded local speech model, compatible worker, Windows recognizer or system voice is available.',
        };
      }
      return {
        speechToText,
        textToSpeech,
        ...(localSttReady && !system?.speechToText
          ? { reason: 'A downloaded offline speech model is available in Pixel.' }
          : undefined),
      };
    } catch (error) {
      return {
        speechToText: false,
        textToSpeech: false,
        reason: `Windows speech services are unavailable: ${message(error)}`,
      };
    }
  }

  /**
   * Listen once and return what was recognised.
   * `signal` lets the user cancel by releasing push-to-talk.
   */
  async listen(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RecognitionResult> {
    if (process.platform !== 'win32') {
      return { ok: false, text: '', error: 'Voice input is only supported on Windows.' };
    }

    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 8_000, 1_000), MAX_LISTEN_MS);
    const script = buildRecognitionScript(timeoutMs);
    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', onParentAbort, { once: true });
    this.activeControllers.add(controller);

    try {
      const output = await runPowerShell(script, timeoutMs + 10_000, controller.signal);
      const parsed = parseRecognition(output);
      if (!parsed) {
        return {
          ok: false,
          text: '',
          error: 'The speech recognizer returned nothing usable.',
        };
      }
      return parsed;
    } catch (error) {
      return { ok: false, text: '', error: message(error) };
    } finally {
      options.signal?.removeEventListener('abort', onParentAbort);
      this.activeControllers.delete(controller);
    }
  }

  /** Transcribe an in-memory mono 16 kHz PCM WAV captured by the renderer. */
  async transcribeWav(input: Uint8Array, signal?: AbortSignal, model = 'base.en'): Promise<RecognitionResult> {
    if (process.platform !== 'win32') {
      return { ok: false, text: '', error: 'Voice input is only supported on Windows.' };
    }
    const validation = validateVoiceWav(input);
    if (validation) return { ok: false, text: '', error: validation };
    if (signal?.aborted) return { ok: false, text: '', error: 'Transcription was cancelled.' };

    const startedAt = performance.now();
    const file = join(tmpdir(), `pixel-voice-${process.pid}-${randomUUID()}.wav`);
    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });
    this.activeControllers.add(controller);

    try {
      writeFileSync(file, Buffer.from(input), { flag: 'wx', mode: 0o600 });
      if (this.pythonWorker && this.voiceModels && !controller.signal.aborted) {
        try {
          const preferredModel = resolveWhisperModel(model);
          const modelPath = await this.voiceModels.getSttModelPath(preferredModel);
          if (modelPath) {
            const capabilities = await this.pythonWorker.capabilities();
            if (!capabilities.ok || capabilities.result.optional.faster_whisper !== true) {
              return { ok: false, text: '', error: 'Pixel’s packaged local speech runtime is unavailable. Reinstall Pixel to repair it.' };
            }
            const whisper = await this.pythonWorker.transcribeAudio(file, preferredModel, modelPath, controller.signal);
            if (whisper.ok) {
              const text = whisper.result.text.trim().replace(/\s+/g, ' ');
              if (text.length < 2) return { ok: false, text: '', noSpeech: true, error: 'No speech was detected.' };
              return {
                ok: true, text,
                ...(whisper.result.language ? { language: whisper.result.language } : {}),
                model: preferredModel,
                backend: whisper.result.backend ?? 'faster-whisper/cpu-int8',
                ...(typeof whisper.result.audioSeconds === 'number' ? { audioSeconds: whisper.result.audioSeconds } : {}),
                ...(typeof whisper.result.processingMs === 'number' ? { processingMs: whisper.result.processingMs } : {}),
              };
            }
            if (whisper.error.code === 'NO_TEXT') return { ok: false, text: '', noSpeech: true, error: whisper.error.message };
            if (whisper.error.code === 'CANCELLED' || controller.signal.aborted) return { ok: false, text: '', error: 'Transcription was cancelled.' };
            return { ok: false, text: '', error: whisper.error.message };
          }
        } catch (error) {
          if (controller.signal.aborted) return { ok: false, text: '', error: 'Transcription was cancelled.' };
          return { ok: false, text: '', error: message(error) };
        }
      }
      if (controller.signal.aborted) return { ok: false, text: '', error: 'Transcription was cancelled.' };
      const output = await runPowerShell(
        buildWaveRecognitionScript(MAX_VOICE_AUDIO_MS + 5_000),
        MAX_VOICE_AUDIO_MS + 15_000,
        controller.signal,
        { CYPS_AUDIO_FILE: file },
      );
      const parsed = parseRecognition(output);
      return parsed
        ? { ...parsed, backend: 'Windows System.Speech', processingMs: Math.round(performance.now() - startedAt) }
        : { ok: false, text: '', error: 'The speech recognizer returned nothing usable.' };
    } catch (error) {
      return { ok: false, text: '', error: message(error) };
    } finally {
      signal?.removeEventListener('abort', onParentAbort);
      this.activeControllers.delete(controller);
      try { unlinkSync(file); } catch { /* the temp file may not have been created */ }
    }
  }

  /** Speak through the explicitly selected local engine; never silently switch engines. */
  async speak(text: string, settings?: VoiceSettings, onPlaybackState?: (speaking: boolean) => void): Promise<SpeechResult> {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Speech is only supported on Windows.' };
    }
    const clean = text.trim();
    if (clean.length === 0) return { ok: false, error: 'There is nothing to say.' };
    if (clean.length > 20_000) return { ok: false, error: 'That response is too long to speak safely.' };
    if (this.speaking) return { ok: false, error: 'Pixel is already speaking. Stop the current reply before starting another.' };

    this.speaking = true;
    let playbackActive = false;
    const setPlaybackActive = (active: boolean): void => {
      if (playbackActive === active) return;
      playbackActive = active;
      this.playbackActive = active;
      try { onPlaybackState?.(active); } catch { /* UI state reporting must not interrupt local speech. */ }
    };
    const speakStartedAt = performance.now();
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      if (settings?.ttsEngine === 'kokoro') {
        if (!this.pythonWorker || !this.voiceModels) return { ok: false, error: 'Pixel’s neural speech runtime is unavailable.' };
        const assets = await this.voiceModels.getTtsAssets();
        if (!assets) return { ok: false, error: 'Download the Kokoro voice model in Settings before selecting it.' };
        // Kokoro's current API produces a WAV before playback. Split at safe
        // sentence/phrase boundaries to stay within its per-call cap. Playback
        // is deliberately serial (with possible small gaps) and cancellable.
        let generationMs = 0;
        let playbackMs = 0;
        for (const chunk of splitSpeechText(clean)) {
          if (controller.signal.aborted) return { ok: false, error: 'Speech was cancelled.' };
          const outputPath = join(tmpdir(), `pixel-voice-tts-${process.pid}-${randomUUID()}.wav`);
          try {
            const generated = await this.pythonWorker.synthesizeKokoro(
              chunk,
              settings.ttsVoice ?? 'af_heart',
              settings.ttsRate,
              assets.modelPath,
              assets.voicesPath,
              outputPath,
              controller.signal,
            );
            if (!generated.ok) return { ok: false, error: generated.error.message };
            generationMs += generated.result.processingMs ?? 0;
            const playbackStarted = performance.now();
            try {
              await runPowerShell(PLAY_WAV_SCRIPT, 120_000, controller.signal, { CYPS_AUDIO_FILE: outputPath }, () => setPlaybackActive(true));
            } finally {
              setPlaybackActive(false);
            }
            playbackMs += performance.now() - playbackStarted;
          } finally {
            try { unlinkSync(outputPath); } catch { /* temporary speech is always best-effort cleaned */ }
          }
        }
        return { ok: true, backend: 'Kokoro ONNX', generationMs, playbackMs: Math.round(playbackMs), elapsedMs: Math.round(performance.now() - speakStartedAt) };
      }
      const rate = Math.max(-10, Math.min(10, Math.round(((settings?.ttsRate ?? 1) - 1) * 25)));
      try {
        await runPowerShell(SPEAK_SCRIPT, 300_000, controller.signal, {
          CYPS_SPEAK_TEXT: clean,
          CYPS_SPEAK_VOICE: settings?.ttsVoice ?? '',
          CYPS_SPEAK_RATE: String(rate),
        }, () => setPlaybackActive(true));
      } finally {
        setPlaybackActive(false);
      }
      return { ok: true, backend: 'Windows System.Speech', elapsedMs: Math.round(performance.now() - speakStartedAt) };
    } catch (error) {
      return { ok: false, error: message(error) };
    } finally {
      setPlaybackActive(false);
      this.speaking = false;
      this.activeControllers.delete(controller);
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  isPlaybackActive(): boolean {
    return this.playbackActive;
  }
}

function resolveWhisperModel(model: string): string {
  if (model === 'tiny' || model === 'tiny.en') return 'tiny.en';
  if (model === 'small' || model === 'small.en') return 'small.en';
  return 'base.en';
}

/* -------------------------------------------------------------------- *
 * Scripts
 *
 * Kept as constants and exported for tests: they are the part most likely to
 * break on an unusual Windows install.
 * -------------------------------------------------------------------- */

export const CAPABILITY_SCRIPT = [
  '$ErrorActionPreference = "Stop";',
  'Add-Type -AssemblyName System.Speech;',
  '$rec = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers().Count;',
  '$tts = [System.Speech.Synthesis.SpeechSynthesizer]::new();',
  '$voices = $tts.GetInstalledVoices().Count;',
  '$tts.Dispose();',
  'Write-Output ("STT={0} TTS={1}" -f $rec, $voices)',
].join(' ');

/** Build the recognition script for a given listening window. */
export function buildRecognitionScript(timeoutMs: number): string {
  return [
    '$ErrorActionPreference = "Stop";',
    'Add-Type -AssemblyName System.Speech;',
    '$rec = [System.Speech.Recognition.SpeechRecognitionEngine]::new();',
    '$rec.SetInputToDefaultAudioDevice();',
    '$rec.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new());',
    `$result = $rec.Recognize([TimeSpan]::FromMilliseconds(${Math.round(timeoutMs)}));`,
    'if ($null -eq $result) {',
    '  Write-Output "NORESULT";',
    '} else {',
    '  Write-Output ("RESULT|{0}|{1}" -f $result.Text.Replace("|", " "), $result.Confidence)',
    '}',
    '$rec.Dispose();',
  ].join(' ');
}

/** Build a script that consumes only the validated transient WAV file. */
export function buildWaveRecognitionScript(timeoutMs: number): string {
  return [
    '$ErrorActionPreference = "Stop";',
    'Add-Type -AssemblyName System.Speech;',
    '$rec = [System.Speech.Recognition.SpeechRecognitionEngine]::new();',
    '$stream = [System.IO.File]::OpenRead($env:CYPS_AUDIO_FILE);',
    'try {',
    '  $rec.SetInputToWaveStream($stream);',
    '  $rec.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new());',
    `  $result = $rec.Recognize([TimeSpan]::FromMilliseconds(${Math.round(timeoutMs)}));`,
    '  if ($null -eq $result) { Write-Output "NORESULT"; }',
    '  else { Write-Output ("RESULT|{0}|{1}" -f $result.Text.Replace("|", " "), $result.Confidence); }',
    '} finally { $stream.Dispose(); $rec.Dispose(); }',
  ].join(' ');
}

/** Reject malformed or oversized audio before it reaches a subprocess. */
export function validateVoiceWav(input: Uint8Array): string | null {
  if (!(input instanceof Uint8Array) || input.byteLength < 44 + 6_400) {
    return 'The recording was too short or malformed to transcribe.';
  }
  if (input.byteLength > MAX_VOICE_WAV_BYTES) return 'The recording exceeded Pixel’s 120-second voice limit.';
  const header = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE' ||
      header.readUInt16LE(20) !== 1 || header.readUInt16LE(22) !== 1 ||
      header.readUInt32LE(24) !== 16_000 || header.readUInt32LE(28) !== 32_000 ||
      header.readUInt16LE(32) !== 2 || header.readUInt16LE(34) !== 16 ||
      header.toString('ascii', 36, 40) !== 'data') {
    return 'Pixel received an unsupported audio format. Try recording again.';
  }
  const dataBytes = header.readUInt32LE(40);
  if (dataBytes !== input.byteLength - 44 || dataBytes % 2 !== 0) {
    return 'Pixel received an incomplete audio recording. Try again.';
  }
  return null;
}

/** Diagnostic export is intentionally capped at 30 seconds. */
export function validateDiagnosticVoiceWav(input: Uint8Array): string | null {
  if (!(input instanceof Uint8Array) || input.byteLength > MAX_VOICE_DIAGNOSTIC_WAV_BYTES) {
    return 'Only a valid diagnostic recording up to 30 seconds can be saved.';
  }
  return validateVoiceWav(input);
}

/** Split speech at punctuation, keeping each Kokoro request below 1,800 chars. */
export function splitSpeechText(text: string, maxLength = 1_800): string[] {
  const normalized = text.replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/([*_])([^*_]+)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let pending = '';
  for (const sentence of normalized.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [normalized]) {
    const part = sentence.trim();
    if (!part) continue;
    if (part.length > maxLength) {
      if (pending) { chunks.push(pending); pending = ''; }
      let remaining = part;
      while (remaining.length > maxLength) {
        let boundary = remaining.lastIndexOf(' ', maxLength);
        if (boundary < Math.floor(maxLength / 2)) boundary = maxLength;
        chunks.push(remaining.slice(0, boundary).trim());
        remaining = remaining.slice(boundary).trimStart();
      }
      if (remaining) chunks.push(remaining);
    } else if (!pending) pending = part;
    else if (pending.length + part.length + 1 <= maxLength) pending += ` ${part}`;
    else { chunks.push(pending); pending = part; }
  }
  if (pending) chunks.push(pending);
  return chunks;
}

export const SPEAK_SCRIPT = [
  '$ErrorActionPreference = "Stop";',
  'Add-Type -AssemblyName System.Speech;',
  '$tts = [System.Speech.Synthesis.SpeechSynthesizer]::new();',
  'if ($env:CYPS_SPEAK_VOICE) { $tts.SelectVoice($env:CYPS_SPEAK_VOICE); }',
  '$tts.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$env:CYPS_SPEAK_RATE));',
  '$tts.Speak($env:CYPS_SPEAK_TEXT);',
  '$tts.Dispose();',
  'Write-Output "SPOKEN"',
].join(' ');

export const PLAY_WAV_SCRIPT = [
  '$ErrorActionPreference = "Stop";',
  '$player = [System.Media.SoundPlayer]::new($env:CYPS_AUDIO_FILE);',
  'try { $player.Load(); $player.PlaySync(); } finally { $player.Dispose(); }',
].join(' ');

export const VOICES_SCRIPT = [
  '$ErrorActionPreference = "Stop";',
  'Add-Type -AssemblyName System.Speech;',
  '$tts = [System.Speech.Synthesis.SpeechSynthesizer]::new();',
  '$names = @($tts.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name });',
  '$tts.Dispose();',
  'ConvertTo-Json -InputObject $names -Compress',
].join(' ');

/* -------------------------------------------------------------------- *
 * Parsing
 * -------------------------------------------------------------------- */

/** Parse the capability probe output. */
export function parseCapability(output: string): { speechToText: boolean; textToSpeech: boolean } | null {
  const match = /STT=(\d+)\s+TTS=(\d+)/.exec(output);
  if (!match) return null;
  return {
    speechToText: Number(match[1]) > 0,
    textToSpeech: Number(match[2]) > 0,
  };
}

/** Parse a recognition result line. */
export function parseRecognition(output: string): RecognitionResult | null {
  const trimmed = output.trim();
  if (trimmed.includes('NORESULT')) {
    return { ok: false, text: '', noSpeech: true, error: 'No speech was detected.' };
  }

  const match = /RESULT\|(.*)\|([\d.]+)/.exec(trimmed);
  if (!match) return null;

  const text = match[1].trim();
  const confidence = Number(match[2]);
  if (text.length === 0) {
    return { ok: false, text: '', noSpeech: true, error: 'No speech was detected.' };
  }

  return {
    ok: true,
    text,
    confidence: Number.isFinite(confidence) ? confidence : undefined,
  };
}

/* -------------------------------------------------------------------- *
 * Process helper
 * -------------------------------------------------------------------- */

function runPowerShell(
  script: string,
  timeoutMs: number,
  signal?: AbortSignal,
  extraEnv: NodeJS.ProcessEnv = {},
  onStarted?: () => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // A signal that is already aborted never fires its listener, so check first.
    // Without this, cancelling before the process starts would still record.
    if (signal?.aborted) {
      reject(new Error('Listening was cancelled.'));
      return;
    }

    let settled = false;
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, ...extraEnv } },
      (error, stdout) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(typeof stdout === 'string' ? stdout : '');
      },
    );
    child.once('spawn', () => onStarted?.());

    signal?.addEventListener(
      'abort',
      () => {
        if (settled) return;
        settled = true;
        terminateProcessTree(child);
        reject(new Error('Listening was cancelled.'));
      },
      { once: true },
    );
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
