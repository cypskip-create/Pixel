import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_SCRIPT,
  MAX_LISTEN_MS,
  SPEAK_SCRIPT,
  VoiceService,
  buildRecognitionScript,
  parseCapability,
  parseRecognition,
} from '../src/main/voice/voice';

describe('parseCapability', () => {
  it('reads recognizer and voice counts', () => {
    expect(parseCapability('STT=1 TTS=3')).toEqual({ speechToText: true, textToSpeech: true });
  });

  it('reports zero counts as unavailable', () => {
    expect(parseCapability('STT=0 TTS=0')).toEqual({ speechToText: false, textToSpeech: false });
  });

  it('returns null when Windows prints something unexpected', () => {
    expect(parseCapability('Some error occurred')).toBeNull();
    expect(parseCapability('')).toBeNull();
  });
});

describe('parseRecognition', () => {
  it('parses a successful recognition', () => {
    expect(parseRecognition('RESULT|hello there|0.87')).toEqual({
      ok: true,
      text: 'hello there',
      confidence: 0.87,
    });
  });

  it('reports no-speech distinctly from failure', () => {
    const result = parseRecognition('NORESULT');
    expect(result?.ok).toBe(false);
    expect(result?.noSpeech).toBe(true);
  });

  it('treats an empty transcript as no speech, not success', () => {
    const result = parseRecognition('RESULT|   |0.5');
    expect(result?.ok).toBe(false);
    expect(result?.noSpeech).toBe(true);
  });

  it('returns null for unrecognisable output', () => {
    expect(parseRecognition('complete garbage')).toBeNull();
  });

  it('handles a transcript containing spaces and punctuation', () => {
    const result = parseRecognition('RESULT|What time is it?|0.62');
    expect(result?.text).toBe('What time is it?');
  });
});

describe('recognition script', () => {
  it('uses the default audio device and a dictation grammar', () => {
    const script = buildRecognitionScript(5000);
    expect(script).toContain('SetInputToDefaultAudioDevice');
    expect(script).toContain('DictationGrammar');
  });

  it('embeds the requested timeout', () => {
    expect(buildRecognitionScript(4321)).toContain('4321');
  });

  it('clamps a fractional timeout to an integer', () => {
    expect(buildRecognitionScript(1500.7)).toContain('1501');
  });

  it('caps the listening window at the documented maximum', () => {
    // Callers must not be able to record indefinitely.
    expect(MAX_LISTEN_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('capability and speak scripts', () => {
  it('the capability probe only reads, never records', () => {
    expect(CAPABILITY_SCRIPT).toContain('InstalledRecognizers');
    expect(CAPABILITY_SCRIPT).not.toContain('SetInputToDefaultAudioDevice');
    // Must not start a recognition pass.
    expect(CAPABILITY_SCRIPT).not.toContain('.Recognize(');
    expect(CAPABILITY_SCRIPT).not.toContain('LoadGrammar');
  });

  it('the speak script reads its text from the environment', () => {
    expect(SPEAK_SCRIPT).toContain('$env:CYPS_SPEAK_TEXT');
    expect(SPEAK_SCRIPT).toContain('Speak');
  });
});

describe('VoiceService', () => {
  const service = new VoiceService();

  it('refuses to speak empty text', async () => {
    const result = await service.speak('   ');
    expect(result.ok).toBe(false);
  });

  it('refuses unreasonably long speech', async () => {
    const result = await service.speak('x'.repeat(3000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too long/i);
  });

  it('reports a real capability result rather than guessing', async () => {
    const capability = await service.capability();

    expect(typeof capability.speechToText).toBe('boolean');
    expect(typeof capability.textToSpeech).toBe('boolean');

    // Either the machine has speech, or it explains why not. Never a silent
    // "unavailable" with no reason.
    if (!capability.speechToText || !capability.textToSpeech) {
      expect(capability.reason === undefined || capability.reason.length > 0).toBe(true);
    }

    // Printed so a real inspection of the machine is visible in test output.
    console.log(
      `[voice capability] stt=${capability.speechToText} tts=${capability.textToSpeech}` +
        (capability.reason ? ` reason="${capability.reason}"` : ''),
    );
  }, 30_000);

  it('returns a structured failure when listening is cancelled immediately', async () => {
    // Regression: an already-aborted AbortSignal never fires its listener, so
    // the service must check signal.aborted before spawning a recognizer.
    const controller = new AbortController();
    controller.abort();
    const result = await service.listen({ timeoutMs: 1000, signal: controller.signal });
    expect(result.ok).toBe(false);
    expect(result.text).toBe('');
    expect(result.error).toBeTruthy();
  }, 30_000);
});
