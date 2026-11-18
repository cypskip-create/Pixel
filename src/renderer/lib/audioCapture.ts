/** Explicit, in-memory microphone capture shared by dictation entry points. */

export const VOICE_CAPTURE_SAMPLE_RATE = 16_000;
export const VOICE_CAPTURE_MAX_MS = 20_000;

export type AudioLevelListener = (level: number) => void;

/**
 * Captures only while start() has been explicitly called. Raw chunks remain in
 * renderer memory and are discarded after stop() or cancel().
 */
export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frame: number | null = null;
  private safetyTimer: number | null = null;
  private chunks: Blob[] = [];
  private cancelled = false;
  private stopped = false;
  private stopPromise: Promise<Uint8Array> | null = null;
  private resolveStop: ((audio: Uint8Array) => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;
  private readonly onLevel: AudioLevelListener;

  constructor(onLevel: AudioLevelListener = () => undefined, private readonly onSafetyTimeout?: () => void) {
    this.onLevel = onLevel;
  }

  async start(deviceId?: string | null, recordAudio = true): Promise<void> {
    if (this.recorder || this.stream) throw new Error('Microphone capture is already active.');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
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
    this.stopped = false;
    this.chunks = [];

    try {
      const context = new AudioContext();
      this.context = context;
      await context.resume();
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
        const recorder = new MediaRecorder(stream);
        this.recorder = recorder;
        recorder.addEventListener('dataavailable', (event) => {
          if (!this.cancelled && event.data.size > 0) this.chunks.push(event.data);
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Microphone capture did not start.')), 2_000);
          recorder.addEventListener('start', () => {
            window.clearTimeout(timeout);
            resolve();
          }, { once: true });
          recorder.addEventListener('error', () => {
            window.clearTimeout(timeout);
            reject(new Error('The microphone recorder failed to start.'));
          }, { once: true });
          try {
            recorder.start(250);
          } catch (error) {
            window.clearTimeout(timeout);
            reject(microphoneError(error));
          }
        });
      }
      this.safetyTimer = window.setTimeout(() => {
        this.safetyTimer = null;
        if (!this.onSafetyTimeout) { this.cancel(); return; }
        try { this.onSafetyTimeout(); } catch { this.cancel(); }
      }, VOICE_CAPTURE_MAX_MS);
    } catch (error) {
      this.cancel();
      throw microphoneError(error);
    }
  }

  /** Stops the device immediately, then returns a mono 16 kHz PCM WAV buffer. */
  stop(): Promise<Uint8Array> {
    if (this.stopPromise) return this.stopPromise;
    if (this.safetyTimer !== null) window.clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.releaseResources();
      return Promise.reject(new Error('No active microphone recording was available.'));
    }

    this.stopped = true;
    this.stopPromise = new Promise<Uint8Array>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    recorder.addEventListener('stop', () => {
      void this.encodeCapturedAudio();
    }, { once: true });
    recorder.addEventListener('error', () => {
      this.rejectStop?.(new Error('The microphone recording could not be finalized.'));
      this.clearStopHandlers();
      this.releaseResources();
    }, { once: true });
    try {
      recorder.stop();
    } catch (error) {
      this.rejectStop?.(microphoneError(error));
      this.clearStopHandlers();
      this.releaseResources();
    }
    return this.stopPromise;
  }

  /** Stops and discards the recording without producing a transcript request. */
  cancel(): void {
    this.cancelled = true;
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* the device may already have stopped */ }
    }
    this.chunks = [];
    this.rejectStop?.(new Error('Microphone capture was cancelled.'));
    this.clearStopHandlers();
    this.releaseResources();
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

  private async encodeCapturedAudio(): Promise<void> {
    if (this.cancelled) return;
    const chunks = this.chunks;
    const context = this.context;
    try {
      if (!context || chunks.length === 0) throw new Error('No microphone audio was captured.');
      const blob = new Blob(chunks);
      const encoded = await blob.arrayBuffer();
      const source = await context.decodeAudioData(encoded.slice(0));
      const sampleCount = Math.ceil(source.duration * VOICE_CAPTURE_SAMPLE_RATE);
      if (sampleCount < VOICE_CAPTURE_SAMPLE_RATE / 5) {
        throw new Error('The recording was too short to transcribe.');
      }
      if (sampleCount > VOICE_CAPTURE_SAMPLE_RATE * (VOICE_CAPTURE_MAX_MS / 1000 + 1)) {
        throw new Error('The recording exceeded Pixel’s 20-second voice limit.');
      }
      const offline = new OfflineAudioContext(1, sampleCount, VOICE_CAPTURE_SAMPLE_RATE);
      const sourceNode = offline.createBufferSource();
      sourceNode.buffer = source;
      sourceNode.connect(offline.destination);
      sourceNode.start();
      const resampled = await offline.startRendering();
      const wav = encodePcm16Wav(resampled.getChannelData(0), VOICE_CAPTURE_SAMPLE_RATE);
      this.resolveStop?.(wav);
    } catch (error) {
      this.rejectStop?.(microphoneError(error));
    } finally {
      this.chunks = [];
      this.clearStopHandlers();
      this.releaseResources();
    }
  }

  private clearStopHandlers(): void {
    this.resolveStop = null;
    this.rejectStop = null;
  }

  private releaseResources(): void {
    if (this.safetyTimer !== null) window.clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.recorder = null;
    this.analyser = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.onLevel(0);
  }
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
