/** Explicit in-memory PCM microphone capture shared by Pixel dictation modes. */

export const VOICE_CAPTURE_SAMPLE_RATE = 16_000;
export const VOICE_CAPTURE_MAX_MS = 120_000;
const MIN_CAPTURE_MS = 200;

export interface VoiceCaptureDiagnostics {
  captureDurationMs: number;
  startedAtUnixMs: number;
  stoppedAtUnixMs: number;
  inputSampleRate: number | null;
  captureSampleRate: number;
  outputSampleRate: number;
  sampleCount: number;
  rmsDbfs: number;
  peakDbfs: number;
  clippingPercent: number;
  lowEnergyPercent: number;
  inputDeviceId: string | null;
}

export type AudioLevelListener = (level: number) => void;

/**
 * Captures direct Float32 PCM only after start() is explicitly called. It does
 * not encode through MediaRecorder/Opus. Chromium's WebAudio resampler converts
 * the captured device stream to 16 kHz before the PCM16 WAV is made.
 */
export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private frame: number | null = null;
  private safetyTimer: number | null = null;
  private pcmChunks: Float32Array[] = [];
  private pcmSampleCount = 0;
  private cancelled = false;
  private stopped = false;
  private flushing = false;
  private recording = false;
  private flushResolver: (() => void) | null = null;
  private stopPromise: Promise<Uint8Array> | null = null;
  private startedAt = 0;
  private startedAtUnixMs = 0;
  private stoppedAt = 0;
  private stoppedAtUnixMs = 0;
  private inputSampleRate: number | null = null;
  private inputDeviceId: string | null = null;
  private captureSampleRate = 0;
  private lastDiagnostics: VoiceCaptureDiagnostics | null = null;
  private readonly onLevel: AudioLevelListener;

  constructor(onLevel: AudioLevelListener = () => undefined, private readonly onSafetyTimeout?: () => void) {
    this.onLevel = onLevel;
  }

  async start(deviceId?: string | null, recordAudio = true, maxDurationMs = VOICE_CAPTURE_MAX_MS): Promise<void> {
    if (this.recording || this.stream) throw new Error('Microphone capture is already active.');
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      throw new Error('This Electron renderer does not provide microphone capture.');
    }

    const audio: MediaTrackConstraints = {
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    };

    this.cancelled = false;
    this.stopped = false;
    this.lastDiagnostics = null;
    this.pcmChunks = [];
    this.pcmSampleCount = 0;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (error) {
      throw microphoneError(error);
    }
    if (this.cancelled) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error('Microphone capture was cancelled.');
    }

    this.stream = stream;
    const trackSettings = stream.getAudioTracks()[0]?.getSettings();
    this.inputSampleRate = typeof trackSettings?.sampleRate === 'number' ? trackSettings.sampleRate : null;
    this.inputDeviceId = trackSettings?.deviceId ?? null;

    try {
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      this.captureSampleRate = context.sampleRate;

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      analyser.connect(silentOutput);
      silentOutput.connect(context.destination);
      this.analyser = analyser;
      this.monitorLevel();

      if (recordAudio) {
        if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
          throw new Error('Direct PCM microphone capture is unavailable in this Electron runtime.');
        }
        const workletUrl = new URL('./audio/pcm-capture-worklet.js', window.location.href);
        await context.audioWorklet.addModule(workletUrl.href);
        const worklet = new AudioWorkletNode(context, 'pixel-pcm-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        worklet.port.addEventListener('message', (event: MessageEvent<{ type: string; samples?: Float32Array }>) => {
          if (event.data.type === 'pcm' && event.data.samples instanceof Float32Array && !this.cancelled && (!this.stopped || this.flushing)) {
            this.pcmChunks.push(event.data.samples);
            this.pcmSampleCount += event.data.samples.length;
          } else if (event.data.type === 'flushed') {
            this.flushing = false;
            this.flushResolver?.();
            this.flushResolver = null;
          }
        });
        worklet.port.start();
        source.connect(worklet);
        worklet.connect(silentOutput);
        this.worklet = worklet;
        this.recording = true;
        this.startedAt = performance.now();
        this.startedAtUnixMs = Date.now();
      }

      const maxMs = Math.min(Math.max(maxDurationMs, MIN_CAPTURE_MS), VOICE_CAPTURE_MAX_MS);
      this.safetyTimer = window.setTimeout(() => {
        this.safetyTimer = null;
        if (!this.onSafetyTimeout) { this.cancel(); return; }
        try { this.onSafetyTimeout(); } catch { this.cancel(); }
      }, maxMs);
    } catch (error) {
      this.cancel();
      throw microphoneError(error);
    }
  }

  /** Stops the device and returns a mono 16 kHz PCM WAV. */
  stop(): Promise<Uint8Array> {
    if (this.stopPromise) return this.stopPromise;
    if (!this.recording || !this.worklet || !this.context) {
      this.releaseResources();
      return Promise.reject(new Error('No active microphone recording was available.'));
    }
    if (this.safetyTimer !== null) window.clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
    this.stopped = true;
    this.flushing = true;
    this.stoppedAt = performance.now();
    this.stoppedAtUnixMs = Date.now();
    this.recording = false;
    for (const track of this.stream?.getAudioTracks() ?? []) track.stop();
    this.stopPromise = this.finalizeRecording();
    return this.stopPromise;
  }

  /** Captured metadata is ephemeral and contains no transcript or audio. */
  diagnostics(): VoiceCaptureDiagnostics | null {
    return this.lastDiagnostics ? { ...this.lastDiagnostics } : null;
  }

  /** Stops and discards the recording without making a transcription request. */
  cancel(): void {
    this.cancelled = true;
    this.pcmChunks = [];
    this.pcmSampleCount = 0;
    this.flushResolver?.();
    this.flushResolver = null;
    this.releaseResources();
  }

  private async finalizeRecording(): Promise<Uint8Array> {
    const context = this.context;
    const worklet = this.worklet;
    try {
      if (!context || !worklet) throw new Error('The microphone capture pipeline is unavailable.');
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('The microphone PCM buffer did not flush.')), 2_000);
        this.flushResolver = () => { window.clearTimeout(timeout); resolve(); };
        worklet.port.postMessage({ type: 'flush' });
      });
      if (this.cancelled) throw new Error('Microphone capture was cancelled.');
      if (this.pcmSampleCount < this.captureSampleRate * MIN_CAPTURE_MS / 1000) {
        throw new Error('The recording was too short to transcribe.');
      }

      const sourceSamples = concatenate(this.pcmChunks, this.pcmSampleCount);
      const targetSampleCount = Math.ceil(sourceSamples.length * VOICE_CAPTURE_SAMPLE_RATE / context.sampleRate);
      const source = context.createBuffer(1, sourceSamples.length, context.sampleRate);
      const copySamples = new Float32Array(sourceSamples.length);
      copySamples.set(sourceSamples);
      source.copyToChannel(copySamples, 0);
      const offline = new OfflineAudioContext(1, targetSampleCount, VOICE_CAPTURE_SAMPLE_RATE);
      const node = offline.createBufferSource();
      node.buffer = source;
      node.connect(offline.destination);
      node.start();
      const resampled = await offline.startRendering();
      const samples = resampled.getChannelData(0);
      if (samples.length > VOICE_CAPTURE_SAMPLE_RATE * (VOICE_CAPTURE_MAX_MS / 1000)) {
        throw new Error('The recording exceeded Pixel’s 120-second voice limit.');
      }

      this.lastDiagnostics = analyzeCapture(samples, {
        captureDurationMs: Math.max(0, Math.round((this.stoppedAt || performance.now()) - this.startedAt)),
        startedAtUnixMs: this.startedAtUnixMs,
        stoppedAtUnixMs: this.stoppedAtUnixMs || Date.now(),
        inputSampleRate: this.inputSampleRate,
        captureSampleRate: context.sampleRate,
        outputSampleRate: VOICE_CAPTURE_SAMPLE_RATE,
        inputDeviceId: this.inputDeviceId,
      });
      return encodePcm16Wav(samples, VOICE_CAPTURE_SAMPLE_RATE);
    } catch (error) {
      this.lastDiagnostics = null;
      throw microphoneError(error);
    } finally {
      this.pcmChunks = [];
      this.pcmSampleCount = 0;
      this.releaseResources();
    }
  }

  private monitorLevel(): void {
    const analyser = this.analyser;
    if (!analyser || this.cancelled || this.stopped) return;
    const values = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(values);
    let sum = 0;
    for (const value of values) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const level = Math.max(0, Math.min(1, Math.sqrt(sum / values.length) * 4));
    this.onLevel(level);
    this.frame = window.requestAnimationFrame(() => this.monitorLevel());
  }

  private releaseResources(): void {
    if (this.safetyTimer !== null) window.clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.worklet = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.analyser = null;
    this.recording = false;
    this.flushing = false;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.onLevel(0);
  }
}

export function analyzeCapture(samples: Float32Array, details: Omit<VoiceCaptureDiagnostics, 'sampleCount' | 'rmsDbfs' | 'peakDbfs' | 'clippingPercent' | 'lowEnergyPercent'>): VoiceCaptureDiagnostics {
  if (samples.length === 0) {
    return { ...details, sampleCount: 0, rmsDbfs: -120, peakDbfs: -120, clippingPercent: 0, lowEnergyPercent: 100 };
  }
  let squares = 0;
  let peak = 0;
  let clipped = 0;
  let lowEnergy = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    squares += sample * sample;
    peak = Math.max(peak, absolute);
    if (absolute >= 0.999) clipped += 1;
    if (absolute < 0.005) lowEnergy += 1;
  }
  const rms = Math.sqrt(squares / samples.length);
  return {
    ...details,
    sampleCount: samples.length,
    rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : -120,
    peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -120,
    clippingPercent: clipped / samples.length * 100,
    lowEnergyPercent: lowEnergy / samples.length * 100,
  };
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const wav = new Uint8Array(44 + dataBytes);
  const view = new DataView(wav.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return wav;
}

function concatenate(chunks: readonly Float32Array[], length: number): Float32Array {
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function microphoneError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return new Error('Microphone permission was denied. Allow Pixel to use the microphone in Windows privacy settings.');
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return new Error('No microphone is available. Connect a microphone or choose another input device in Settings.');
    }
    if (error.name === 'OverconstrainedError' || error.name === 'NotReadableError') {
      return new Error('The selected microphone is unavailable. Choose another input device in Settings.');
    }
    return error;
  }
  return new Error('Microphone capture failed. Check the device and Windows privacy permissions.');
}
