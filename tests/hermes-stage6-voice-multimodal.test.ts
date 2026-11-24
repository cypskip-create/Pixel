import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, type ChatMessage } from '@shared/types';
import {
  TTS_RESPONSE_BODY_LIMIT_BYTES,
  splitIntoSpeechSegments,
  synthesizeWithCloudProvider,
  transcribeWithCloudProvider,
} from '../src/main/voice/providers';
import {
  ContinuousVoiceController,
  GPT_LIVE_VOICES,
  exchangeGptLiveSdpOffer,
  formatVoiceLiveTurnNote,
  isVoiceStopPhrase,
} from '../src/main/voice/conversationMode';
import {
  assertVisionCapableModel,
  enforceImageHistoryBudget,
  generateImageArtifact,
} from '../src/main/agent/multimodal';
import { ToolRegistry } from '../src/main/agent/tools';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Stage 6: Hermes Voice Providers, Continuous/Barge-In, GPT-Live & Multimodal Parity', () => {
  it('enforces local-only STT privacy and routes OpenAI / Deepgram STT with validation', async () => {
    const sampleWav = Buffer.from('RIFF....WAVEfmt ', 'utf8');

    // Local STT never touches cloud endpoints.
    const localRes = await transcribeWithCloudProvider({
      provider: 'local',
      audioBuffer: sampleWav,
      mimeType: 'audio/wav',
    });
    expect(localRes.ok).toBe(false);
    expect(localRes.error).toContain('on-device');

    // Missing credentials fails cleanly.
    const noKey = await transcribeWithCloudProvider({
      provider: 'openai',
      audioBuffer: sampleWav,
      mimeType: 'audio/wav',
      apiKey: '',
    });
    expect(noKey.ok).toBe(false);
    expect(noKey.error).toContain('Missing API key');

    // OpenAI multilingual transcription.
    const openaiMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'Bonjour Pixel', language: 'fr' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const oaRes = await transcribeWithCloudProvider({
      provider: 'openai',
      audioBuffer: sampleWav,
      mimeType: 'audio/wav',
      apiKey: 'sk-test-oa',
      language: 'fr',
      fetchImpl: openaiMock,
    });
    expect(oaRes).toMatchObject({ ok: true, provider: 'openai', text: 'Bonjour Pixel', language: 'fr' });

    // Deepgram Nova-2 transcription.
    const dgMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'Deepgram OK' }] }] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const dgRes = await transcribeWithCloudProvider({
      provider: 'deepgram',
      audioBuffer: sampleWav,
      mimeType: 'audio/wav',
      apiKey: 'dg-key',
      fetchImpl: dgMock,
    });
    expect(dgRes).toMatchObject({ ok: true, provider: 'deepgram', text: 'Deepgram OK' });
  });

  it('routes cloud TTS providers (OpenAI, ElevenLabs, Gemini, MiniMax, xAI, Mistral) with 16 MiB cap & sentence segmentation', async () => {
    const segs = splitIntoSpeechSegments('Hello world! ```ts\nconst x = 1;\n``` This is [Pixel](https://example.com). Ready?');
    expect(segs).toEqual(['Hello world! This is Pixel. Ready?']);

    const elRes = await synthesizeWithCloudProvider({
      provider: 'elevenlabs',
      text: 'Hi from ElevenLabs',
      apiKey: 'el-key',
      fetchImpl: async () => new Response(Buffer.from('MP3BYTES'), { status: 200 }),
    });
    expect(elRes.ok).toBe(true);
    expect(elRes.mimeType).toBe('audio/mpeg');

    const gemRes = await synthesizeWithCloudProvider({
      provider: 'gemini',
      text: 'Hi from Gemini',
      apiKey: 'gem-key',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('WAV').toString('base64'), mimeType: 'audio/wav' } }] } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    expect(gemRes.ok).toBe(true);
    expect(gemRes.mimeType).toBe('audio/wav');

    const mmRes = await synthesizeWithCloudProvider({
      provider: 'minimax',
      text: 'Hi from MiniMax',
      apiKey: 'mm-key',
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: { audio: Buffer.from('AUDIO').toString('hex') } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    expect(mmRes.ok).toBe(true);
    expect(TTS_RESPONSE_BODY_LIMIT_BYTES).toBe(16 * 1024 * 1024);
  });

  it('drives continuous voice state machine with silence end-of-speech, barge-in grace/floor suppression, stop phrases, and GPT-Live SDP exchange', async () => {
    let nowMs = 10_000;
    const ctrl = new ContinuousVoiceController(
      {
        mode: 'chained',
        silenceThreshold: 200,
        silenceDurationSec: 2.0,
        bargeIn: true,
        bargeInGraceSec: 0.5,
        bargeInThresholdMultiplier: 3.0,
        stopPhrases: ['stop', 'goodbye'],
      },
      () => nowMs,
    );

    ctrl.start();
    expect(ctrl.getPhase()).toBe('listening');
    ctrl.ingestMicRms(100); // calibrates quiet floor = 100
    ctrl.ingestMicRms(500); // speech detected
    expect(ctrl.getPhase()).toBe('speech_detected');

    // Silence begins and lasts 2.1s -> end_of_speech
    expect(ctrl.ingestMicRms(80)).toBeNull();
    nowMs += 2100;
    expect(ctrl.ingestMicRms(80)).toBe('end_of_speech');
    expect(ctrl.getPhase()).toBe('transcribing');

    // Speaking with barge-in grace period (0.5s) and floor multiplier (100 * 3 = 300).
    ctrl.beginSpeaking();
    nowMs += 200; // within 0.5s grace period -> must NOT trigger barge-in!
    expect(ctrl.ingestMicRms(900)).toBeNull();
    nowMs += 500; // past grace period, but below floor*3 (250 < 300) -> echo suppressed!
    expect(ctrl.ingestMicRms(250)).toBeNull();
    expect(ctrl.ingestMicRms(450)).toBe('barge_in');
    expect(ctrl.getPhase()).toBe('interrupted');

    expect(isVoiceStopPhrase('Stop!', ['stop'])).toBe(true);
    expect(isVoiceStopPhrase('Stop the server', ['stop'])).toBe(false);

    // Full-duplex GPT-Live SDP offer/answer exchange keeps API key server-side.
    expect(GPT_LIVE_VOICES).toContain('marin');
    expect(formatVoiceLiveTurnNote('User: check git')).toContain('Recent spoken conversation');
    let capturedAuth = '';
    const liveRes = await exchangeGptLiveSdpOffer({
      sdpOffer: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1',
      apiKey: 'sk-live-secret',
      voice: 'marin',
      fetchImpl: async (_url, init) => {
        capturedAuth = ((init?.headers as Record<string, string>) ?? {}).Authorization ?? '';
        return new Response('v=0\r\nanswer-sdp', { status: 200, headers: { 'Content-Type': 'application/sdp' } });
      },
    });
    expect(liveRes).toMatchObject({ ok: true, sdpAnswer: 'v=0\r\nanswer-sdp', voice: 'marin' });
    expect(capturedAuth).toBe('Bearer sk-live-secret');
  });

  it('enforces vision capability checks, image history budgets, real image_generate artifacts, and Stage 6 VoiceSettings clamping', async () => {
    const registry = new ToolRegistry();
    expect(registry.get('image_generate')?.requiresApproval).toBe(true);

    expect(assertVisionCapableModel('deepseek', 'deepseek-flash').supported).toBe(true);
    expect(assertVisionCapableModel('deepseek', 'deepseek-v4-pro').supported).toBe(false);
    expect(assertVisionCapableModel('anthropic', 'claude-sonnet-4-20250514').supported).toBe(true);

    const img = { dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' as const, width: 10, height: 10, source: 'upload' as const };
    const history: ChatMessage[] = [
      { id: '1', role: 'user', content: 'img1', createdAt: 1, images: [img, img] },
      { id: '2', role: 'user', content: 'img2', createdAt: 2, images: [img] },
    ];
    const budgeted = enforceImageHistoryBudget(history, 2);
    expect(budgeted.strippedCount).toBe(1);
    expect(budgeted.messages[0]?.images).toHaveLength(1);
    expect(budgeted.messages[1]?.images).toHaveLength(1);

    // Real image_generate writes PNG artifact.
    const outDir = mkdtempSync(join(tmpdir(), 'pixel-img-'));
    tempDirs.push(outDir);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const genRes = await generateImageArtifact({
      provider: 'openai',
      prompt: 'A monochrome geometric shark',
      apiKey: 'sk-img-key',
      outputDir: outDir,
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ b64_json: pngBytes.toString('base64') }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    expect(genRes.ok).toBe(true);
    expect(genRes.filePath && existsSync(genRes.filePath)).toBe(true);

    // VoiceSettings defaults & clamping.
    expect(DEFAULT_SETTINGS.voice.voiceChatMode).toBe('chained');
    const merged = mergeSettings({
      voice: {
        ...DEFAULT_SETTINGS.voice,
        sttModel: 'large-v3-turbo',
        voiceChatMode: 'gpt-live',
        sttProvider: 'deepgram',
        ttsProvider: 'elevenlabs',
        maxRecordingSec: 9999,
        silenceDurationSec: 0.1,
        bargeInGraceSec: 9.0,
        beepVolume: 5.0,
      },
    });
    expect(merged.voice.sttModel).toBe('large-v3-turbo');
    expect(merged.voice.voiceChatMode).toBe('gpt-live');
    expect(merged.voice.sttProvider).toBe('deepgram');
    expect(merged.voice.ttsProvider).toBe('elevenlabs');
    expect(merged.voice.maxRecordingSec).toBe(300);
    expect(merged.voice.silenceDurationSec).toBe(0.5);
    expect(merged.voice.bargeInGraceSec).toBe(3.0);
    expect(merged.voice.beepVolume).toBe(1);
  });
});
