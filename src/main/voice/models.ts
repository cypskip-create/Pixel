import { createHash } from 'node:crypto';
import { open, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type VoiceModelId =
  | 'tiny.en'
  | 'base.en'
  | 'small.en'
  | 'tiny'
  | 'base'
  | 'small'
  | 'large-v3-turbo'
  | 'kokoro-v1.0-int8';
export type VoiceModelKind = 'stt' | 'tts';

export interface VoiceModelInfo {
  id: VoiceModelId;
  label: string;
  kind: VoiceModelKind;
  sizeBytes: number;
  downloaded: boolean;
  valid: boolean;
  license: string;
  source: string;
}

export interface VoiceModelProgress {
  id: VoiceModelId;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface VoiceModelFile {
  name: string;
  url: string;
  estimatedBytes: number;
  maxBytes: number;
  sha256?: string;
}

export interface VoiceModelCatalogEntry extends VoiceModelInfo {
  files: readonly VoiceModelFile[];
}

const STT_FILES = (
  repository: string,
  revision: string,
  weightsBytes: number,
  weightsSha256?: string,
  org = 'Systran',
  maxWeightsBytes = 900_000_000,
): readonly VoiceModelFile[] => {
  const base = `https://huggingface.co/${org}/${repository}/resolve/${revision}`;
  return [
    {
      name: 'model.bin',
      url: `${base}/model.bin`,
      estimatedBytes: weightsBytes,
      maxBytes: maxWeightsBytes,
      ...(weightsSha256 ? { sha256: weightsSha256 } : {}),
    },
    { name: 'config.json', url: `${base}/config.json`, estimatedBytes: 3_000, maxBytes: 100_000 },
    { name: 'tokenizer.json', url: `${base}/tokenizer.json`, estimatedBytes: 2_130_000, maxBytes: 10_000_000 },
    { name: 'vocabulary.txt', url: `${base}/vocabulary.txt`, estimatedBytes: 500_000, maxBytes: 2_000_000 },
  ];
};

export const VOICE_MODEL_CATALOG: readonly VoiceModelCatalogEntry[] = [
  {
    id: 'tiny.en', label: 'Tiny English · fastest', kind: 'stt', sizeBytes: 79_000_000,
    downloaded: false, valid: false, license: 'MIT', source: 'Systran/faster-whisper-tiny.en @ 0d3d19a32d3338f10357c0889762bd8d64bbdeba',
    files: STT_FILES('faster-whisper-tiny.en', '0d3d19a32d3338f10357c0889762bd8d64bbdeba', 75_500_000, '1a5afae06a4db91c975c9a9d78be5cc110ee4ea022ad57d55492e4550e936b2a'),
  },
  {
    id: 'base.en', label: 'Base English · balanced', kind: 'stt', sizeBytes: 152_000_000,
    downloaded: false, valid: false, license: 'MIT', source: 'Systran/faster-whisper-base.en @ 3d3d5de (pinned revision)',
    files: STT_FILES('faster-whisper-base.en', '3d3d5de', 145_200_000, '2a166925539a16005f14ff328359f9b9adb9dc4fb631bb3b227526862e93e2ef'),
  },
  {
    id: 'small.en', label: 'Small English · higher memory', kind: 'stt', sizeBytes: 507_000_000,
    downloaded: false, valid: false, license: 'MIT', source: 'Systran/faster-whisper-small.en @ d1d751a (pinned revision)',
    files: STT_FILES('faster-whisper-small.en', 'd1d751a', 483_500_000, '62b2a45b05ee59acb4a5341b33ee35e041395d378d418a18acfe4c9e768ee37a'),
  },
  {
    id: 'tiny', label: 'Tiny Multilingual · 99 languages', kind: 'stt', sizeBytes: 80_000_000,
    downloaded: false, valid: false, license: 'MIT', source: 'Systran/faster-whisper-tiny @ main',
    files: STT_FILES('faster-whisper-tiny', 'main', 75_500_000),
  },
  {
    id: 'base', label: 'Base Multilingual · balanced', kind: 'stt', sizeBytes: 153_000_000,
    downloaded: false, valid: false, license: 'MIT', source: 'Systran/faster-whisper-base @ main',
    files: STT_FILES('faster-whisper-base', 'main', 145_200_000),
  },
  {
    id: 'small', label: 'Small Multilingual · accurate', kind: 'stt', sizeBytes: 508_000_000,
    downloaded: false, valid: false, license: 'MIT', source: 'Systran/faster-whisper-small @ main',
    files: STT_FILES('faster-whisper-small', 'main', 483_500_000),
  },
  {
    id: 'large-v3-turbo', label: 'Large v3 Turbo Multilingual · highest quality', kind: 'stt', sizeBytes: 860_000_000,
    downloaded: false, valid: false, license: 'MIT', source: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo @ main',
    files: STT_FILES('faster-whisper-large-v3-turbo', 'main', 809_000_000, undefined, 'mobiuslabsgmbh', 1_200_000_000),
  },
  {
    id: 'kokoro-v1.0-int8', label: 'Kokoro English · natural neural voice', kind: 'tts', sizeBytes: 143_000_000,
    downloaded: false, valid: false, license: 'Apache-2.0 model; MIT ONNX runtime; see voice notices',
    source: 'thewh1teagle/kokoro-onnx model-files-v1.1',
    files: [
      { name: 'kokoro-v1.0.int8.onnx', url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx', estimatedBytes: 114_000_000, maxBytes: 200_000_000, sha256: 'ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c' },
      { name: 'voices-v1.0.bin', url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin', estimatedBytes: 28_000_000, maxBytes: 60_000_000, sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' },
    ],
  },
];

/**
 * Downloads only allowlisted model assets into Pixel's user-data directory.
 * Partial files are retained for HTTP Range resume; final directories become
 * visible atomically only after checksums and model structure have passed.
 */
export class VoiceModelManager {
  private active: { id: VoiceModelId; controller: AbortController; progress: VoiceModelProgress } | null = null;

  constructor(
    private readonly root: string,
    private readonly onProgress: (progress: VoiceModelProgress | null) => void = () => undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly catalog: readonly VoiceModelCatalogEntry[] = VOICE_MODEL_CATALOG,
  ) {}

  async list(): Promise<VoiceModelInfo[]> {
    return Promise.all(this.catalog.map(async (model) => {
      const valid = await this.isInstalled(model);
      return {
        id: model.id,
        label: model.label,
        kind: model.kind,
        sizeBytes: model.sizeBytes,
        downloaded: valid,
        valid,
        license: model.license,
        source: model.source,
      };
    }));
  }

  async getSttModelPath(id: string): Promise<string | null> {
    const model = this.find(id, 'stt');
    if (!model || !(await this.isInstalled(model))) return null;
    return this.modelDir(model.id);
  }

  async getTtsAssets(): Promise<{ modelPath: string; voicesPath: string } | null> {
    const model = this.find('kokoro-v1.0-int8', 'tts');
    if (!model || !(await this.isInstalled(model))) return null;
    const dir = this.modelDir(model.id);
    return { modelPath: join(dir, 'kokoro-v1.0.int8.onnx'), voicesPath: join(dir, 'voices-v1.0.bin') };
  }

  async download(id: string): Promise<{ ok: boolean; error?: string }> {
    const model = this.find(id);
    if (!model) return { ok: false, error: 'That voice model is not supported.' };
    if (this.active) return { ok: false, error: 'Another voice model download is already running.' };
    if (await this.isInstalled(model)) return { ok: true };

    const controller = new AbortController();
    const staging = `${this.modelDir(model.id)}.partial`;
    this.active = { id: model.id, controller, progress: { id: model.id, receivedBytes: 0, totalBytes: model.sizeBytes, percent: 0 } };
    try {
      await mkdir(staging, { recursive: true });
      let completed = 0;
      for (const file of model.files) {
        if (controller.signal.aborted) throw new Error('Download cancelled.');
        const destination = join(staging, file.name);
        if (await this.fileIsValid(destination, file)) {
          completed += file.estimatedBytes;
          this.report(completed, model.sizeBytes);
          continue;
        }
        await this.downloadFile(file, destination, controller.signal, (received) => this.report(completed + received, model.sizeBytes));
        if (!(await this.fileIsValid(destination, file))) {
          await rm(destination, { force: true });
          throw new Error(`Integrity verification failed for ${file.name}. The incomplete file was removed.`);
        }
        const details = await stat(destination);
        completed += details.size;
        this.report(completed, model.sizeBytes);
      }
      await this.validateModel(model, staging);
      await writeFile(join(staging, 'pixel-model.json'), JSON.stringify({ id: model.id, source: model.source, license: model.license }), 'utf8');
      await rm(this.modelDir(model.id), { recursive: true, force: true });
      await rename(staging, this.modelDir(model.id));
      this.onProgress(null);
      return { ok: true };
    } catch (error) {
      if (controller.signal.aborted) {
        return { ok: false, error: 'Voice model download cancelled. Its partial files are kept so it can resume later.' };
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Voice model download failed.' };
    } finally {
      this.active = null;
      this.onProgress(null);
    }
  }

  cancelDownload(): boolean {
    if (!this.active) return false;
    this.active.controller.abort();
    return true;
  }

  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const model = this.find(id);
    if (!model) return { ok: false, error: 'That voice model is not supported.' };
    if (this.active?.id === model.id) return { ok: false, error: 'Cancel the model download before removing it.' };
    try {
      await rm(this.modelDir(model.id), { recursive: true, force: true });
      await rm(`${this.modelDir(model.id)}.partial`, { recursive: true, force: true });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Pixel could not remove the voice model.' };
    }
  }

  get downloadingId(): VoiceModelId | null {
    return this.active?.id ?? null;
  }

  private report(receivedBytes: number, totalBytes: number): void {
    const progress = {
      id: this.active!.id,
      receivedBytes: Math.max(0, receivedBytes),
      totalBytes,
      percent: Math.max(0, Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))),
    };
    this.active!.progress = progress;
    this.onProgress(progress);
  }

  private async downloadFile(file: VoiceModelFile, destination: string, signal: AbortSignal, onProgress: (received: number) => void): Promise<void> {
    await mkdir(join(destination, '..'), { recursive: true });
    let offset = 0;
    try { offset = (await stat(`${destination}.part`)).size; } catch { /* first attempt */ }
    if (offset > file.maxBytes) {
      await rm(`${destination}.part`, { force: true });
      offset = 0;
    }
    const response = await this.fetcher(file.url, {
      signal,
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
      redirect: 'follow',
    });
    if (response.status !== 200 && response.status !== 206) throw new Error(`Download failed for ${file.name} (HTTP ${response.status}).`);
    let append = false;
    if (offset > 0 && response.status === 206) {
      const range = response.headers.get('content-range');
      if (!range || !new RegExp(`^bytes ${offset}-\\d+/`).test(range)) throw new Error(`The server returned an invalid resume range for ${file.name}.`);
      append = true;
    } else {
      offset = 0;
    }
    if (!response.body) throw new Error(`The download for ${file.name} had no content.`);
    const handle = await open(`${destination}.part`, append ? 'a' : 'w');
    let received = offset;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (signal.aborted) throw new Error('Download cancelled.');
        received += chunk.value.byteLength;
        if (received > file.maxBytes) throw new Error(`The download for ${file.name} exceeded its allowed size.`);
        let written = 0;
        while (written < chunk.value.byteLength) {
          const result = await handle.write(chunk.value, written, chunk.value.byteLength - written);
          if (result.bytesWritten <= 0) throw new Error(`Could not write ${file.name}.`);
          written += result.bytesWritten;
        }
        onProgress(received);
      }
      if (signal.aborted) throw new Error('Download cancelled.');
    } finally {
      await handle.close();
    }
    await rename(`${destination}.part`, destination);
  }

  private async isInstalled(model: VoiceModelCatalogEntry): Promise<boolean> {
    const dir = this.modelDir(model.id);
    try {
      const marker = JSON.parse(await readFile(join(dir, 'pixel-model.json'), 'utf8')) as { id?: unknown; source?: unknown };
      if (marker.id !== model.id || marker.source !== model.source) return false;
      await this.validateModel(model, dir);
      return true;
    } catch {
      return false;
    }
  }

  private async validateModel(model: VoiceModelCatalogEntry, dir: string): Promise<void> {
    for (const file of model.files) {
      if (!(await this.fileIsValid(join(dir, file.name), file))) throw new Error(`The downloaded ${file.name} is missing or corrupt.`);
    }
    if (model.kind === 'stt') {
      const config = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')) as unknown;
      const tokenizer = JSON.parse(await readFile(join(dir, 'tokenizer.json'), 'utf8')) as unknown;
      if (!config || typeof config !== 'object' || !tokenizer || typeof tokenizer !== 'object' ||
        (await readFile(join(dir, 'vocabulary.txt'), 'utf8')).trim().length === 0) {
        throw new Error('The speech model metadata is incomplete or corrupt.');
      }
    }
  }

  private async fileIsValid(path: string, file: VoiceModelFile): Promise<boolean> {
    try {
      const details = await stat(path);
      if (!details.isFile() || details.size === 0 || details.size > file.maxBytes) return false;
      if (!file.sha256) return true;
      const hash = createHash('sha256');
      const handle = await open(path, 'r');
      try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (bytesRead === 0) break;
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
      } finally {
        await handle.close();
      }
      return hash.digest('hex') === file.sha256;
    } catch {
      return false;
    }
  }

  private modelDir(id: VoiceModelId): string {
    return join(this.root, id);
  }

  private find(id: string, kind?: VoiceModelKind): VoiceModelCatalogEntry | undefined {
    return this.catalog.find((model) => model.id === id && (!kind || model.kind === kind));
  }
}
