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

/** Longest single dictation window. */
export const MAX_LISTEN_MS = 20_000;
export const MAX_VOICE_WAV_BYTES = 44 + 16_000 * 2 * 21;

export interface VoiceCapability {
  speechToText: boolean;
  textToSpeech: boolean;
  reason?: string;
}

export interface RecognitionResult {
  ok: boolean;
  text: string;
  confidence: number;
  error?: string;
  /** True when the recognizer heard nothing rather than failing. */
  noSpeech?: boolean;
}

export class VoiceService {
  private speaking = false;
  private readonly activeControllers = new Set<AbortController>();
  private capabilityCache: VoiceCapability | null = null;
  private capabilityPending: Promise<VoiceCapability> | null = null;

  constructor(private readonly pythonWorker?: PythonWorker) {
    // A forced process exit can bypass finally; delete only Pixel's generated
    // short-lived voice buffers from an earlier run when the service restarts.
    try {
      for (const name of readdirSync(tmpdir())) {
        const match = /^pixel-voice-(\d+)-[a-f0-9-]+\.wav$/i.exec(name);
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
      const [systemResult, pythonResult] = await Promise.allSettled([
        runPowerShell(CAPABILITY_SCRIPT, 15_000).then(parseCapability),
        this.pythonWorker?.capabilities() ?? Promise.resolve(null),
      ]);
      const system = systemResult.status === 'fulfilled' ? systemResult.value : null;
      const python = pythonResult.status === 'fulfilled' && pythonResult.value?.ok
        ? pythonResult.value.result
        : null;
      const fasterWhisper = python?.optional.faster_whisper === true;
      const speechToText = Boolean(system?.speechToText || fasterWhisper);
      const textToSpeech = Boolean(system?.textToSpeech);
      if (!speechToText && !textToSpeech) {
        return {
          speechToText: false,
          textToSpeech: false,
          reason: 'No local speech recognizer or voice is available for this Windows account.',
        };
      }
      return {
        speechToText,
        textToSpeech,
        ...(fasterWhisper && !system?.speechToText
          ? { reason: 'Offline faster-whisper is installed. Pixel will check for the selected local model when you transcribe.' }
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
      return { ok: false, text: '', confidence: 0, error: 'Voice input is only supported on Windows.' };
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
          confidence: 0,
          error: 'The speech recognizer returned nothing usable.',
        };
      }
      return parsed;
    } catch (error) {
      return { ok: false, text: '', confidence: 0, error: message(error) };
    } finally {
      options.signal?.removeEventListener('abort', onParentAbort);
      this.activeControllers.delete(controller);
    }
  }

  /** Transcribe a short, in-memory mono 16 kHz PCM WAV captured by the renderer. */
  async transcribeWav(input: Uint8Array, signal?: AbortSignal, model = 'base.en'): Promise<RecognitionResult> {
    if (process.platform !== 'win32') {
      return { ok: false, text: '', confidence: 0, error: 'Voice input is only supported on Windows.' };
    }
    const validation = validateVoiceWav(input);
    if (validation) return { ok: false, text: '', confidence: 0, error: validation };
    if (signal?.aborted) return { ok: false, text: '', confidence: 0, error: 'Transcription was cancelled.' };

    const file = join(tmpdir(), `pixel-voice-${process.pid}-${randomUUID()}.wav`);
    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });
    this.activeControllers.add(controller);

    try {
      writeFileSync(file, Buffer.from(input), { flag: 'wx', mode: 0o600 });
      if (this.pythonWorker && !controller.signal.aborted) {
        try {
          const capabilities = await this.pythonWorker.capabilities();
          if (capabilities.ok && capabilities.result.optional.faster_whisper === true) {
            const preferredModel = resolveWhisperModel(model);
            const whisper = await this.pythonWorker.transcribeAudio(file, preferredModel, controller.signal);
            if (whisper.ok) {
              const text = whisper.result.text.trim().replace(/\s+/g, ' ');
              if (text.length < 2) return { ok: false, text: '', confidence: 0, noSpeech: true, error: 'No speech was detected.' };
              return { ok: true, text, confidence: 0 };
            }
            if (whisper.error.code === 'NO_TEXT') {
              return { ok: false, text: '', confidence: 0, noSpeech: true, error: whisper.error.message };
            }
            if (whisper.error.code === 'CANCELLED' || controller.signal.aborted) {
              return { ok: false, text: '', confidence: 0, error: 'Transcription was cancelled.' };
            }
            // A missing model or failed optional backend falls through to the
            // Windows local recognizer. No model is downloaded automatically.
          }
        } catch {
          // Optional Python inference does not prevent the Windows fallback.
        }
      }
      if (controller.signal.aborted) return { ok: false, text: '', confidence: 0, error: 'Transcription was cancelled.' };
      const output = await runPowerShell(
        buildWaveRecognitionScript(MAX_LISTEN_MS),
        MAX_LISTEN_MS + 10_000,
        controller.signal,
        { CYPS_AUDIO_FILE: file },
      );
      const parsed = parseRecognition(output);
      return parsed ?? { ok: false, text: '', confidence: 0, error: 'The speech recognizer returned nothing usable.' };
    } catch (error) {
      return { ok: false, text: '', confidence: 0, error: message(error) };
    } finally {
      signal?.removeEventListener('abort', onParentAbort);
      this.activeControllers.delete(controller);
      try { unlinkSync(file); } catch { /* the temp file may not have been created */ }
    }
  }

  /** Speak text with the installed system voice. */
  async speak(text: string): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Speech is only supported on Windows.' };
    }
    const clean = text.trim();
    if (clean.length === 0) return { ok: false, error: 'There is nothing to say.' };
    if (clean.length > 2_000) {
      return { ok: false, error: 'That text is too long to speak in one go.' };
    }

    this.speaking = true;
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      // The text is passed through the environment so it cannot break out of
      // the PowerShell command.
      await runPowerShell(SPEAK_SCRIPT, 60_000, controller.signal, { CYPS_SPEAK_TEXT: clean });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: message(error) };
    } finally {
      this.speaking = false;
      this.activeControllers.delete(controller);
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
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
  if (input.byteLength > MAX_VOICE_WAV_BYTES) return 'The recording exceeded Pixel’s 20-second voice limit.';
  const header = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE' ||
      header.readUInt16LE(20) !== 1 || header.readUInt16LE(22) !== 1 ||
      header.readUInt32LE(24) !== 16_000 || header.readUInt16LE(34) !== 16 ||
      header.toString('ascii', 36, 40) !== 'data') {
    return 'Pixel received an unsupported audio format. Try recording again.';
  }
  const dataBytes = header.readUInt32LE(40);
  if (dataBytes !== input.byteLength - 44 || dataBytes % 2 !== 0) {
    return 'Pixel received an incomplete audio recording. Try again.';
  }
  return null;
}

export const SPEAK_SCRIPT = [
  '$ErrorActionPreference = "Stop";',
  'Add-Type -AssemblyName System.Speech;',
  '$tts = [System.Speech.Synthesis.SpeechSynthesizer]::new();',
  '$tts.Speak($env:CYPS_SPEAK_TEXT);',
  '$tts.Dispose();',
  'Write-Output "SPOKEN"',
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
    return { ok: false, text: '', confidence: 0, noSpeech: true, error: 'No speech was detected.' };
  }

  const match = /RESULT\|(.*)\|([\d.]+)/.exec(trimmed);
  if (!match) return null;

  const text = match[1].trim();
  const confidence = Number(match[2]);
  if (text.length === 0) {
    return { ok: false, text: '', confidence: 0, noSpeech: true, error: 'No speech was detected.' };
  }

  return {
    ok: true,
    text,
    confidence: Number.isFinite(confidence) ? confidence : 0,
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
