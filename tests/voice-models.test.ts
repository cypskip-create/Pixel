import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VOICE_MODEL_CATALOG, VoiceModelManager } from '../src/main/voice/models';
import type { VoiceModelCatalogEntry } from '../src/main/voice/models';
import { PythonWorker } from '../src/main/services/python-worker';

const roots: string[] = [];
const data = new TextEncoder().encode('pixel-local-voice-model-asset');
const hash = createHash('sha256').update(data).digest('hex');

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-voice-model-test-'));
  roots.push(dir);
  return dir;
}

function catalog(): VoiceModelCatalogEntry[] {
  return [{
    id: 'kokoro-v1.0-int8', label: 'Test model', kind: 'tts', sizeBytes: data.byteLength,
    downloaded: false, valid: false, license: 'MIT', source: 'test-pinned-revision',
    files: [{ name: 'asset.bin', url: 'https://models.invalid/asset.bin', estimatedBytes: data.byteLength, maxBytes: 1024, sha256: hash }],
  }];
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('VoiceModelManager', () => {
  it('exposes pinned MIT English/multilingual Whisper models and the checksum-pinned Kokoro asset pair', () => {
    expect(VOICE_MODEL_CATALOG.map((model) => model.id)).toEqual([
      'tiny.en',
      'base.en',
      'small.en',
      'tiny',
      'base',
      'small',
      'large-v3-turbo',
      'kokoro-v1.0-int8',
    ]);
    for (const model of VOICE_MODEL_CATALOG.slice(0, 3)) {
      expect(model.license).toBe('MIT');
      expect(model.files.some((file) => file.name === 'model.bin' && /^[a-f0-9]{64}$/.test(file.sha256 ?? ''))).toBe(true);
      expect(model.files.every((file) => file.url.includes('/resolve/'))).toBe(true);
    }
    const kokoro = VOICE_MODEL_CATALOG.find((m) => m.id === 'kokoro-v1.0-int8');
    expect(kokoro?.files.map((file) => file.sha256)).toEqual([
      'ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c',
      'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
    ]);
  });

  it('rejects unlisted model identifiers without making a network request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const manager = new VoiceModelManager(root(), undefined, fetcher, catalog());
    await expect(manager.download('../outside')).resolves.toEqual({ ok: false, error: 'That voice model is not supported.' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('downloads to the controlled directory, checks SHA-256 and reports ready only afterward', async () => {
    const manager = new VoiceModelManager(root(), undefined, async () => new Response(data), catalog());
    const result = await manager.download('kokoro-v1.0-int8');
    expect(result).toEqual({ ok: true });
    const [model] = await manager.list();
    expect(model).toMatchObject({ downloaded: true, valid: true, kind: 'tts' });
  });

  it('detects local corruption on the next status check', async () => {
    const modelRoot = root();
    const manager = new VoiceModelManager(modelRoot, undefined, async () => new Response(data), catalog());
    await manager.download('kokoro-v1.0-int8');
    writeFileSync(join(modelRoot, 'kokoro-v1.0-int8', 'asset.bin'), 'tampered');
    const [model] = await manager.list();
    expect(model.downloaded).toBe(false);
    expect(model.valid).toBe(false);
  });

  it('retains a cancelled partial and resumes it with a validated HTTP Range response', async () => {
    const modelRoot = root();
    let manager: VoiceModelManager;
    let first = true;
    let cancelRequested = false;
    const requests: Array<{ range: string | null }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get('range');
      requests.push({ range });
      if (range) {
        const offset = Number(/^bytes=(\d+)-$/.exec(range)?.[1]);
        return new Response(data.subarray(offset), {
          status: 206,
          headers: { 'content-range': `bytes ${offset}-${data.byteLength - 1}/${data.byteLength}` },
        });
      }
      if (first) {
        first = false;
        let pull = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pull++ === 0) controller.enqueue(data.subarray(0, 8));
            else { controller.enqueue(data.subarray(8)); controller.close(); }
          },
        });
        return new Response(stream);
      }
      return new Response(data);
    };
    manager = new VoiceModelManager(modelRoot, (progress) => {
      if (!cancelRequested && progress && progress.receivedBytes >= 8) {
        cancelRequested = true;
        manager.cancelDownload();
      }
    }, fetcher, catalog());

    const cancelled = await manager.download('kokoro-v1.0-int8');
    expect(cancelled.ok).toBe(false);
    expect(cancelled.error).toMatch(/cancelled/i);
    expect(readFileSync(join(modelRoot, 'kokoro-v1.0-int8.partial', 'asset.bin.part')).byteLength).toBe(8);

    const resumed = await manager.download('kokoro-v1.0-int8');
    expect(resumed).toEqual({ ok: true });
    expect(requests[1]?.range).toBe('bytes=8-');
    expect((await manager.list())[0]?.valid).toBe(true);
  });

  it('removes only allowlisted model directories and partial data', async () => {
    const modelRoot = root();
    const manager = new VoiceModelManager(modelRoot, undefined, async () => new Response(data), catalog());
    await manager.download('kokoro-v1.0-int8');
    await expect(manager.remove('kokoro-v1.0-int8')).resolves.toEqual({ ok: true });
    expect((await manager.list())[0]?.downloaded).toBe(false);
    await expect(manager.remove('..')).resolves.toMatchObject({ ok: false });
  });
});

describe('packaged voice runtime policy', () => {
  it('does not fall back to a globally installed Python when the packaged worker is missing', () => {
    const worker = new PythonWorker({
      requirePackagedWorker: true,
      packagedWorkerPath: join(root(), 'missing', 'PixelVoiceWorker.exe'),
    });
    expect(worker.availability()).toMatchObject({
      available: false,
      reason: expect.stringContaining('bundled speech worker is missing'),
    });
  });
});
