import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeCapture, encodePcm16Wav, VOICE_CAPTURE_MAX_MS, VOICE_CAPTURE_SAMPLE_RATE } from '../src/renderer/lib/audioCapture';

describe('direct PCM voice capture', () => {
  it('keeps a bounded 16 kHz output suitable for up to two minutes', () => {
    expect(VOICE_CAPTURE_SAMPLE_RATE).toBe(16_000);
    expect(VOICE_CAPTURE_MAX_MS).toBe(120_000);
  });

  it('reports silence and clipping accurately without recording content', () => {
    const details = {
      captureDurationMs: 100,
      startedAtUnixMs: 1,
      stoppedAtUnixMs: 101,
      inputSampleRate: 48_000,
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      inputDeviceId: null,
    };
    expect(analyzeCapture(new Float32Array(10), details)).toMatchObject({
      sampleCount: 10, rmsDbfs: -120, peakDbfs: -120, clippingPercent: 0, lowEnergyPercent: 100,
    });
    const signal = analyzeCapture(new Float32Array([-1, 1, 0, 0]), details);
    expect(signal.clippingPercent).toBe(50);
    expect(signal.lowEnergyPercent).toBe(50);
    expect(signal.rmsDbfs).toBeCloseTo(-3.0103, 3);
  });

  it('writes little-endian mono PCM16 data and ships its AudioWorklet asset', () => {
    const wav = encodePcm16Wav(new Float32Array([-1, 1]), 16_000);
    const view = new DataView(wav.buffer);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
    const asset = join(process.cwd(), 'src/renderer/public/audio/pcm-capture-worklet.js');
    expect(existsSync(asset)).toBe(true);
    expect(readFileSync(asset, 'utf8')).toContain("registerProcessor('pixel-pcm-capture'");
  });
});
