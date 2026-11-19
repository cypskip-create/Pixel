import { describe, expect, it } from 'vitest';
import { buildRequestFrames, runWorkerProtocolSmoke, validateResponses } from '../scripts/smoke-frozen-voice-worker.mjs';

function responses() {
  return [
    { id: 'pixel-runtime-smoke', ok: true, result: { protocol: 1, onnxProviders: ['CPUExecutionProvider'], onnxCpuProvider: true, fasterWhisper: true, kokoro: true, espeakReady: true } },
    { id: 'pixel-capabilities-smoke', ok: true, result: { protocol: 1, python: '3.12.10', formats: ['txt', 'pdf'], optional: { pdf: true, kokoro_onnx: true } } },
    { id: 'pixel-shutdown-smoke', ok: true, result: { bye: true } },
  ].map((response) => JSON.stringify(response));
}

describe('frozen voice worker protocol smoke', () => {
  it('builds BOM-free UTF-8 JSON Lines with explicit request ids and shutdown', () => {
    const frame = buildRequestFrames();
    expect(frame.subarray(0, 3).toString('hex')).not.toBe('efbbbf');
    expect(frame.includes(Buffer.from('Pixel — café', 'utf8'))).toBe(true);
    expect(frame.toString('utf8').split('\n').filter(Boolean)).toEqual([
      expect.stringContaining('"id":"pixel-runtime-smoke"'),
      expect.stringContaining('"id":"pixel-capabilities-smoke"'),
      expect.stringContaining('"id":"pixel-shutdown-smoke"'),
    ]);
    expect(frame[frame.length - 1]).toBe(0x0a);
  });

  it('accepts runtime, protocol version and capability response shape', () => {
    const result = validateResponses(responses());
    expect(result.capabilities.python).toMatch(/^3\.12\./);
    expect(result.runtime.onnxCpuProvider).toBe(true);
  });

  it('rejects bad JSON, invalid ids and missing runtime capabilities', () => {
    expect(() => validateResponses(['not-json'])).toThrow('Expected 3');
    const wrongId = responses();
    wrongId[0] = JSON.stringify({ id: 'wrong', ok: true, result: {} });
    expect(() => validateResponses(wrongId)).toThrow('pixel-runtime-smoke');
    const missingCapability = responses();
    missingCapability[1] = JSON.stringify({ id: 'pixel-capabilities-smoke', ok: true, result: { protocol: 1, python: '3.12.10', formats: [], optional: [] } });
    expect(() => validateResponses(missingCapability)).toThrow('unexpected shape');
  });

  it('passes BOM-free UTF-8 frames through a real child-process stdin/stdout boundary', async () => {
    const childSource = `let input=''; process.stderr.write('worker diagnostic stays off stdout\\n'); process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { for (const line of input.trim().split(/\\r?\\n/)) { const request = JSON.parse(line); let result; if (request.op === 'runtime_smoke_test') result = { protocol: 1, onnxProviders: ['CPUExecutionProvider'], onnxCpuProvider: true, fasterWhisper: true, kokoro: true, espeakReady: true }; else if (request.op === 'capabilities') result = { protocol: 1, python: '3.12.10', formats: ['txt'], optional: { pdf: false } }; else result = { bye: true }; process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\\n'); } });`;
    const result = await runWorkerProtocolSmoke(process.execPath, ['-e', childSource], 5_000);
    const frame = Buffer.from(result.frameHex, 'hex');
    expect(frame.subarray(0, 3).toString('hex')).not.toBe('efbbbf');
    expect(frame.toString('utf8')).toContain('"op":"runtime_smoke_test"');
    expect(result.frameBytes).toBe(frame.length);
    expect(result.runtime.onnxCpuProvider).toBe(true);
  });

  it('terminates a child process that exceeds the bounded smoke timeout', async () => {
    const childSource = 'setInterval(() => {}, 1000);';
    await expect(runWorkerProtocolSmoke(process.execPath, ['-e', childSource], 40)).rejects.toThrow('Timed out after 40 ms');
  });
});
