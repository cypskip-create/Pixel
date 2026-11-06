/**
 * Voice input and output.
 *
 * Implemented on Windows' built-in `System.Speech` through PowerShell, so it is
 * a real speech engine rather than a simulation:
 *  - recognition uses the installed desktop recognizer with a dictation grammar;
 *  - synthesis uses the installed system voices.
 *
 * If no recognizer or voice is installed, the capability check says exactly
 * that. Cyps never returns invented transcription.
 *
 * Audio never leaves the machine: recognition runs entirely locally.
 */

import { execFile } from 'node:child_process';

/** Longest single dictation window. */
export const MAX_LISTEN_MS = 20_000;

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

  /** Probe the machine once and cache the answer. */
  async capability(): Promise<VoiceCapability> {
    if (process.platform !== 'win32') {
      return {
        speechToText: false,
        textToSpeech: false,
        reason: 'Voice is only supported on Windows.',
      };
    }

    try {
      const output = await runPowerShell(CAPABILITY_SCRIPT, 15_000);
      const parsed = parseCapability(output);
      if (!parsed) {
        return {
          speechToText: false,
          textToSpeech: false,
          reason: 'Windows speech services did not respond.',
        };
      }
      if (!parsed.speechToText && !parsed.textToSpeech) {
        return {
          ...parsed,
          reason: 'No speech recognizer or voice is installed for this Windows account.',
        };
      }
      return parsed;
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

    try {
      const output = await runPowerShell(script, timeoutMs + 10_000, options.signal);
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
    try {
      // The text is passed through the environment so it cannot break out of
      // the PowerShell command.
      await runPowerShell(SPEAK_SCRIPT, 60_000, undefined, { CYPS_SPEAK_TEXT: clean });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: message(error) };
    } finally {
      this.speaking = false;
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }
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
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
        reject(new Error('Listening was cancelled.'));
      },
      { once: true },
    );
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
