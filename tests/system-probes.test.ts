import { describe, expect, it } from 'vitest';
import { probeVolumeCapacity } from '../src/main/system/probes';

describe('probeVolumeCapacity', () => {
  it('converts filesystem blocks into verified byte totals', () => {
    expect(probeVolumeCapacity('C:\\', () => ({ blocks: 100, bavail: 25, frsize: 4096 }))).toEqual([
      { mount: 'C:\\', totalBytes: 409_600, freeBytes: 102_400 },
    ]);
  });

  it('rejects missing roots, invalid capacity, and overflow instead of fabricating values', () => {
    expect(() => probeVolumeCapacity(' ', () => ({ blocks: 1, bavail: 1, frsize: 1 }))).toThrow(/volume path/i);
    expect(() => probeVolumeCapacity('C:\\', () => ({ blocks: -1, bavail: 1, frsize: 1 }))).toThrow(/invalid capacity/i);
    expect(() => probeVolumeCapacity('C:\\', () => ({ blocks: Number.MAX_SAFE_INTEGER, bavail: 1, frsize: 4096 }))).toThrow(/numeric range/i);
    expect(() => probeVolumeCapacity('C:\\', () => ({ blocks: 1, bavail: 2, frsize: 4096 }))).toThrow(/numeric range/i);
  });
});
