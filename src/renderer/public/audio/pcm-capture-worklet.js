const PIXEL_PCM_BLOCK_FRAMES = 8192;

class PixelPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(PIXEL_PCM_BLOCK_FRAMES);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    if (channels && channels.length > 0) {
      const frames = channels[0].length;
      for (let frame = 0; frame < frames; frame += 1) {
        let mono = 0;
        for (let channel = 0; channel < channels.length; channel += 1) {
          mono += channels[channel][frame] || 0;
        }
        this.buffer[this.offset++] = mono / channels.length;
        if (this.offset === this.buffer.length) this.flush();
      }
    }

    for (const channel of outputs[0] || []) channel.fill(0);
    return true;
  }

  flush() {
    if (this.offset === 0) return;
    const samples = this.buffer.slice(0, this.offset);
    this.offset = 0;
    this.port.postMessage({ type: 'pcm', samples }, [samples.buffer]);
  }
}

registerProcessor('pixel-pcm-capture', PixelPcmCaptureProcessor);
