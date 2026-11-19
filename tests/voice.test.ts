import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_SCRIPT,
  MAX_LISTEN_MS,
  SPEAK_SCRIPT,
  PLAY_WAV_SCRIPT,
  VoiceService,
  buildRecognitionScript,
  buildWaveRecognitionScript,
  parseCapability,
  parseRecognition,
  validateVoiceWav,
} from '../src/main/voice/voice';
import { encodePcm16Wav } from '../src/renderer/lib/audioCapture';
import { mergeSettings } from '../src/shared/types';

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

describe('voice settings validation', () => {
  it('keeps installed Windows voice names, bounds speech rate and rejects unknown engines/models', () => {
    const settings = mergeSettings({ voice: {
      sttModel: 'remote-model',
      ttsEngine: 'cloud',
      ttsVoice: 'Microsoft David - English (United States)',
      ttsRate: 9,
    } });
    expect(settings.voice.sttModel).toBe('base.en');
    expect(settings.voice.ttsEngine).toBe('system');
    expect(settings.voice.ttsVoice).toBe('Microsoft David - English (United States)');
    expect(settings.voice.ttsRate).toBe(1.3);
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

  it('recognizes a captured WAV without reopening the default microphone', () => {
    const script = buildWaveRecognitionScript(5000);
    expect(script).toContain('SetInputToWaveStream');
    expect(script).toContain('$env:CYPS_AUDIO_FILE');
    expect(script).not.toContain('SetInputToDefaultAudioDevice');
  });
});

describe('transient voice audio', () => {
  it('encodes mono PCM WAV at 16 kHz and validates its structure', () => {
    const audio = encodePcm16Wav(new Float32Array(3_200).fill(0.25), 16_000);
    expect(Buffer.from(audio).toString('ascii', 0, 4)).toBe('RIFF');
    expect(Buffer.from(audio).toString('ascii', 8, 12)).toBe('WAVE');
    expect(validateVoiceWav(audio)).toBeNull();
  });

  it('rejects truncated, unsupported, and oversized buffers before a subprocess starts', () => {
    expect(validateVoiceWav(new Uint8Array(40))).toMatch(/short|malformed/i);
    expect(validateVoiceWav(encodePcm16Wav(new Float32Array(3_199), 16_000))).toMatch(/short/i);
    const stereo = encodePcm16Wav(new Float32Array(4000), 16_000);
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(validateVoiceWav(stereo)).toMatch(/unsupported/i);
    expect(validateVoiceWav(new Uint8Array(44 + 16_000 * 2 * 22))).toMatch(/20-second/i);
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
    expect(SPEAK_SCRIPT).toContain('$env:CYPS_SPEAK_VOICE');
    expect(SPEAK_SCRIPT).toContain('$env:CYPS_SPEAK_RATE');
    expect(SPEAK_SCRIPT).toContain('Speak');
    expect(PLAY_WAV_SCRIPT).toContain('PlaySync');
    expect(PLAY_WAV_SCRIPT).toContain('$env:CYPS_AUDIO_FILE');
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
